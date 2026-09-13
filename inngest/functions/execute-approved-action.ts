import { and, eq } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { writeAuditLog } from "@/lib/agent/audit";
import { executeTool } from "@/lib/agent/tools";
import type { TurnActor } from "@/lib/agent/types";
import { db } from "@/lib/db";
import { approvalQueue } from "@/lib/db/schema/approval-queue";
import { teamMembers } from "@/lib/db/schema/team-members";
import { withSystemWebhookContext } from "@/lib/tenant/with-system-webhook-context";

/**
 * SEG-10's replay half: the interceptor (04-06) queues a high-risk proposal
 * and finishes the turn immediately (LD-09 — no `step.waitForEvent`, approval
 * can take days and a suspended run holding a turn open that long is a worse
 * shape than a queue row plus an event). This function is the ONLY consumer
 * of `agent/approval.decided`, and it is what makes an approval or rejection
 * actually happen.
 *
 * A stored proposal is replayed minutes-to-days after it was created, so
 * nothing about it is trusted just because it once passed the interceptor
 * (T-04-13/T-04-43): the scope cross-check on `tool_input` is re-applied
 * here from scratch, not skipped.
 */

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const executeApprovedAction = inngest.createFunction(
  {
    id: "execute-approved-action",
    retries: 3,
    triggers: [{ event: "agent/approval.decided" }],
  },
  async ({ event, step }) => {
    const { agencyId, approvalId, decidedByTeamMemberId } = event.data;

    // Step 1: load the row fresh. Branches on the row's OWN `status`, never
    // on `event.data.decision` — a retry of this same event delivered after
    // a later status change (or a run that raced ahead of the DB commit)
    // must not re-execute or re-audit an action that is no longer in the
    // state the event describes (T-04-44).
    const row = await step.run("load-approval", async () => {
      const [found] = await withSystemWebhookContext(agencyId, (tx) =>
        tx
          .select({
            id: approvalQueue.id,
            status: approvalQueue.status,
            clientId: approvalQueue.clientId,
            actionTypeCode: approvalQueue.actionTypeCode,
            toolName: approvalQueue.toolName,
            toolInput: approvalQueue.toolInput,
            summary: approvalQueue.summary,
            channel: approvalQueue.channel,
            conversationPhoneNumber: approvalQueue.conversationPhoneNumber,
          })
          .from(approvalQueue)
          .where(eq(approvalQueue.id, approvalId)),
      );
      return found ?? null;
    });

    if (!row || (row.status !== "approved" && row.status !== "rejected")) {
      // Nothing to do: the row is missing, already replayed (`executed` /
      // `failed`), or somehow still `pending` — none of those are this
      // function's job.
      return { outcome: "skipped" as const };
    }

    if (row.status === "rejected") {
      // Rejected branch: nothing is executed, nothing is sent. Only the
      // bitácora entry is written, as the system actor (LD-14 — the Server
      // Action that flipped the status could not write `audit_log` itself).
      await step.run("audit-rejection", () =>
        writeAuditLog({
          agencyId,
          clientId: row.clientId,
          actionTypeCode: row.actionTypeCode,
          riskLevel: "high",
          status: "rejected",
          approvalId,
          summary: `Rechazado por el equipo: ${row.summary}`,
        }),
      );
      return { outcome: "rejected" as const };
    }

    // Approved branch. The acting identity is the APPROVER, not the original
    // requester: the action is happening because a team member authorized
    // it, and the tool's own reads (deliver-to-client.ts) must run in a
    // scope that can actually see the client. `approverRole` is not carried
    // on the event, so it is resolved here — BEFORE any scope opens, via the
    // plain `db` export with an explicit `agency_id` filter, the same
    // "resolve identity to plain data before the scope opens" ordering
    // `lib/whatsapp/ingest-inbound-message.ts` established for exactly the
    // same SEG-12 reason. Never hardcode `role: "admin"` — a non-admin
    // member who is assigned to the client can also approve, and hardcoding
    // admin would silently widen `deliverToClient`'s RLS-based scope check
    // for this replay.
    const approver = await step.run("resolve-approver-role", async () => {
      const [member] = await db
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.id, decidedByTeamMemberId),
            eq(teamMembers.agencyId, agencyId),
          ),
        );
      if (!member) {
        throw new Error(
          `No se encontró team_member ${decidedByTeamMemberId} en la agencia ${agencyId}.`,
        );
      }
      return { role: member.role as "admin" | "member" };
    });

    // Step 3: replay the tool call. Errors are NOT caught inside this step —
    // they are caught around it below (T-04-46), so step 4 always runs and
    // records a visible `failed` outcome instead of a silently-lost approved
    // action or an Inngest retry that re-runs (and re-audits) the same call.
    let output: string | null = null;
    let failureMessage: string | null = null;
    try {
      output = await step.run("execute-approved-tool", async () => {
        // Re-apply the interceptor's scope cross-check (RESEARCH.md Pitfall
        // 4 / T-04-43) on the STORED input — a proposal that once passed is
        // not trusted just because it once passed.
        const input = row.toolInput as Record<string, unknown> | null;
        const inputClientId =
          input && typeof input.clientId === "string" ? input.clientId : null;
        if (inputClientId === null || !UUID_REGEX.test(inputClientId)) {
          throw new Error(
            "El tool_input almacenado no tiene un clientId con formato válido.",
          );
        }
        if (row.clientId !== null && inputClientId !== row.clientId) {
          throw new Error(
            "El clientId del tool_input no coincide con el clientId de la fila de aprobación.",
          );
        }

        const actor: TurnActor = {
          agencyId,
          identity: {
            type: "team_member",
            teamMemberId: decidedByTeamMemberId,
            role: approver.role,
          },
          clientId: row.clientId,
          channel: row.channel as "whatsapp" | "web",
          counterpartPhoneNumber: row.conversationPhoneNumber,
        };

        return executeTool(row.toolName, row.toolInput, actor);
      });
    } catch (err) {
      failureMessage = err instanceof Error ? err.message : String(err);
    }

    // Step 4: record the outcome on the queue row and in the bitácora,
    // whichever branch step 3 took.
    await step.run("record-outcome", () =>
      withSystemWebhookContext(agencyId, (tx) =>
        tx
          .update(approvalQueue)
          .set({
            status: failureMessage ? "failed" : "executed",
            executionResult: failureMessage ?? output,
          })
          .where(eq(approvalQueue.id, approvalId)),
      ),
    );

    await writeAuditLog({
      agencyId,
      clientId: row.clientId,
      actionTypeCode: row.actionTypeCode,
      riskLevel: "high",
      status: failureMessage ? "failed" : "approved_executed",
      approvalId,
      summary: failureMessage
        ? `Falló la ejecución de la acción aprobada: ${failureMessage}`
        : row.summary,
    });

    if (failureMessage) {
      return { outcome: "failed" as const, error: failureMessage };
    }
    return { outcome: "executed" as const };
  },
);
