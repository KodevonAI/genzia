"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { approvalQueue } from "@/lib/db/schema/approval-queue";
import { getCurrentTeamMember } from "@/lib/team/current-member";
import { withTenantContext } from "@/lib/tenant/with-tenant-context";

/**
 * SEG-10's other half: the interceptor (04-06) can only queue a high-risk
 * action, never execute it. This module is the only place a human's Clerk
 * session is allowed to touch `approval_queue` — and it is deliberately
 * tiny, because everything that actually matters here is enforced somewhere
 * else:
 *
 * LD-15: who may decide is `approval_queue_decide_by_role`'s job (migration
 * 0016) — admin, or a member assigned to that client, or any member for an
 * agency-internal (`client_id IS NULL`) item. There is NO second role check
 * in this file. RLS's `USING`/`WITH CHECK` on the UPDATE already makes the
 * row invisible/unwriteable to anyone else; duplicating that check here
 * would just be a second copy of the same boundary that can silently drift
 * out of sync with the policy.
 *
 * LD-09: no `step.waitForEvent`. The turn that proposed the action already
 * finished by the time a human decides — approval can take days, and a
 * suspended Inngest run holding that turn open for days is a worse shape
 * than a queue row plus an event. `decide()` below only flips the status and
 * dispatches `agent/approval.decided`; the actual replay happens in
 * `inngest/functions/execute-approved-action.ts`.
 *
 * LD-14: BOTH decisions dispatch the event, and this file writes NO
 * `audit_log` row itself. This Server Action runs under the caller's own
 * Clerk-session scope (`app.role` = admin/member via `withTenantContext`),
 * and migration 0014 restricts `audit_log` INSERTs to `app.actor =
 * 'system_webhook'` — a session scope structurally cannot write the
 * bitácora. The background function, running as the system actor, is what
 * records the decision. Keeping every audit write behind
 * `lib/agent/audit.ts` (the single writer) means there is exactly one
 * audit-writing scope in the whole codebase.
 */

export type DecisionResult = { ok: true } | { ok: false; error: string };

async function decide(
  approvalId: string,
  decision: "approved" | "rejected",
): Promise<DecisionResult> {
  const member = await getCurrentTeamMember();
  if (!member) {
    // Not an error state — the mid-provisioning window `withTenantContext`
    // documents: signed in with Clerk, but no `team_members` row (yet) for
    // this agency.
    return { ok: false, error: "No estás dado de alta como miembro del equipo." };
  }

  const decided = await withTenantContext(async (tx) => {
    // The `status = 'pending'` predicate is what makes a double-click, a
    // stale page, or a redelivered request harmless — only the first
    // decision on a row ever matches this WHERE clause. The SET clause is
    // intentionally limited to these three columns: never widen it to
    // include `tool_input`, `tool_name`, `client_id` or `action_type_code`
    // (T-04-13) — a human editing a proposal before approving it must be
    // impossible through this path.
    return tx
      .update(approvalQueue)
      .set({
        status: decision,
        decidedByTeamMemberId: member.id,
        decidedAt: new Date(),
      })
      .where(
        and(eq(approvalQueue.id, approvalId), eq(approvalQueue.status, "pending")),
      )
      .returning({
        id: approvalQueue.id,
        agencyId: approvalQueue.agencyId,
      });
  });

  const row = decided[0];
  if (!row) {
    // Zero rows means either "already decided" or "not visible to you under
    // `approval_queue_decide_by_role`" — RLS makes those indistinguishable
    // on purpose, so the two cases share one message here.
    return {
      ok: false,
      error: "Esa acción ya fue decidida o no está disponible para vos.",
    };
  }

  // Awaited, not fire-and-forget: a serverless invocation can be frozen
  // before an unawaited promise resolves (same reasoning
  // app/api/webhooks/meta/route.ts already documents for its own
  // inngest.send). Dispatched for BOTH decisions (LD-14) — the background
  // function is what writes the audit entry either way.
  await inngest.send({
    name: "agent/approval.decided",
    data: {
      agencyId: row.agencyId,
      approvalId: row.id,
      decision,
      decidedByTeamMemberId: member.id,
    },
  });

  revalidatePath("/dashboard/bitacora");

  return { ok: true };
}

export async function approveAction(approvalId: string): Promise<DecisionResult> {
  return decide(approvalId, "approved");
}

export async function rejectAction(approvalId: string): Promise<DecisionResult> {
  return decide(approvalId, "rejected");
}
