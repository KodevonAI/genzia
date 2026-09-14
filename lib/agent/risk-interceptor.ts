import type Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentActionCatalog } from "@/lib/db/schema/agent-action-catalog";
import { approvalQueue } from "@/lib/db/schema/approval-queue";
import type { ResolvedIdentity } from "@/lib/identity/types";
import { withSystemWebhookContext } from "@/lib/tenant/with-system-webhook-context";
import { writeAuditLog } from "./audit";
import { executeTool } from "./tools";
import type { TurnActor } from "./types";

/**
 * The SEG-10 gate: every `tool_use` block Claude proposes passes through
 * `classifyAndExecute` before anything real happens. Model output is a
 * proposal, never a command — this is the field's current structural
 * mitigation against prompt injection (RESEARCH.md Pitfall 4 / OWASP LLM
 * Prompt Injection Prevention Cheat Sheet), not a prompted "ignore injected
 * instructions" instruction.
 *
 * The catalog code comes from this hard-coded, code-level map — never from
 * anything in `toolUse.input` or the model's own reasoning. SEG-10 and
 * STACK-AGENT.md §6 both forbid the model influencing its own risk
 * classification, and LD-06 fixes the tool set at exactly these two names.
 */
export const TOOL_TO_CATALOG_CODE: Record<string, string> = {
  send_payment_reminder: "payment_reminder",
  draft_client_content: "new_client_content",
  create_client: "create_client",
  update_client: "update_client",
  list_clients: "list_clients",
  get_client: "get_client",
};

/**
 * T-05-05: the tools whose input names a single existing client that the
 * caller's own identity must be cross-checked against. `create_client` (no
 * client exists yet) and `list_clients` (agency-wide by design, D-11) are
 * deliberately excluded — do not add a new client-scoped tool to this set
 * without also giving it the full UUID-validate + client_contact cross-check
 * path in `classifyAndExecute`.
 */
const CLIENT_SCOPED_TOOLS = new Set([
  "send_payment_reminder",
  "draft_client_content",
  "update_client",
  "get_client",
]);

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractClientId(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>).clientId;
  return typeof value === "string" ? value : null;
}

function requestedByIdentityId(identity: ResolvedIdentity): string | null {
  if (identity.type === "team_member") return identity.teamMemberId;
  if (identity.type === "client_contact") return identity.contactId;
  return null;
}

function rejectResult(
  toolUseId: string,
  message: string,
): Anthropic.Messages.ToolResultBlockParam {
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    content: message,
    is_error: true,
  };
}

/**
 * The human one-liner stored in `audit_log.summary` / `approval_queue.summary`.
 * Never the full tool arguments — those already live as jsonb on the queue
 * row; the bitácora line is meant to be skimmed, not to duplicate storage.
 */
export function describeToolCall(toolUse: {
  name: string;
  input: unknown;
}): string {
  const clientId = extractClientId(toolUse.input);
  return clientId ? `${toolUse.name} → cliente ${clientId}` : toolUse.name;
}

export async function classifyAndExecute(
  toolUse: { id: string; name: string; input: unknown },
  actor: TurnActor,
): Promise<Anthropic.Messages.ToolResultBlockParam> {
  // 1. Map, don't trust. The catalog code is looked up in a code-level map
  // keyed by tool name — never read from `toolUse.input` or any other part
  // of the model's own output. A tool name with no mapping is rejected
  // before any catalog read and before any execution, so an unrecognized
  // (e.g. hallucinated) tool name can never fall through to a default risk
  // level.
  const code = TOOL_TO_CATALOG_CODE[toolUse.name];
  if (!code) {
    return rejectResult(
      toolUse.id,
      `Herramienta no reconocida: ${toolUse.name}`,
    );
  }

  // 2a. Unconditional identity gate — runs for EVERY tool, before any
  // tool-specific logic. An unrecognized sender can never execute any
  // action, client-scoped or not — this should already be unreachable in
  // practice because toolsFor() offers no tools to an unknown identity
  // (LD-12), but the interceptor does not rely on that alone (T-05-06,
  // defense in depth).
  if (actor.identity.type === "unknown") {
    return rejectResult(
      toolUse.id,
      "No autorizado: un remitente no identificado no puede ejecutar acciones.",
    );
  }

  // 2b. Scope cross-check (RESEARCH.md Pitfall 4), only for tools whose
  // input names a single existing client (T-05-05). `create_client` (no
  // client exists yet) and `list_clients` (agency-wide by design, D-11) skip
  // this block entirely — `clientId` stays `null`, no UUID is required. The
  // model's own arguments are attacker-influenceable content (an injected
  // instruction in a message or transcript could otherwise steer `clientId`
  // toward a different client) — the check below does not trust the
  // resolved identity's own claims either, it cross-validates the
  // model-supplied argument against what that identity actually is.
  let clientId: string | null = null;
  if (CLIENT_SCOPED_TOOLS.has(toolUse.name)) {
    clientId = extractClientId(toolUse.input);
    if (clientId === null || !UUID_REGEX.test(clientId)) {
      return rejectResult(
        toolUse.id,
        "El argumento clientId no es un identificador válido.",
      );
    }
    if (
      actor.identity.type === "client_contact" &&
      clientId !== actor.identity.clientId
    ) {
      // Prevents a client contact's turn from ever producing a tool call
      // that targets a different client (SEG-07/T-04-28).
      return rejectResult(
        toolUse.id,
        "No autorizado: este contacto no puede actuar sobre otro cliente.",
      );
    }
  }
  // For a team_member, no assignment check is re-implemented here on
  // purpose: the tool's own reads (deliver-to-client.ts) run inside that
  // member's own RLS scope, so a client outside their assignment yields no
  // authorized contact and delivery fails closed. Duplicating that check
  // here would be a second, driftable copy of the same boundary.

  // 3. Classify — the only source of risk level for this call. `db` (the
  // plain, unscoped connection) is used deliberately: agent_action_catalog
  // is platform-global with no RLS and a SELECT-only grant (migration 0006),
  // one of the few legitimate uses of the unscoped connection this codebase
  // otherwise forbids for tenant data.
  const [catalogRow] = await db
    .select({ riskLevel: agentActionCatalog.riskLevel })
    .from(agentActionCatalog)
    .where(eq(agentActionCatalog.code, code));

  if (!catalogRow) {
    // A missing catalog row is a programming error (a code in the map above
    // with no corresponding seeded row), not a runtime condition to recover
    // from. Fail safe with the conservative classification for the audit
    // trail rather than guessing.
    await writeAuditLog({
      agencyId: actor.agencyId,
      clientId,
      actionTypeCode: code,
      riskLevel: "high",
      summary: describeToolCall(toolUse),
      status: "failed",
    });
    return rejectResult(
      toolUse.id,
      `Error interno: no existe una fila de catálogo para ${code}.`,
    );
  }

  if (catalogRow.riskLevel === "low") {
    // 4. Low branch — execute immediately, then audit. A thrown error from
    // the tool itself must not abort the whole turn; catch it, audit it as
    // failed, and return an error tool_result the model can relay.
    try {
      const output = await executeTool(toolUse.name, toolUse.input, actor);
      await writeAuditLog({
        agencyId: actor.agencyId,
        clientId,
        actionTypeCode: code,
        riskLevel: "low",
        status: "executed",
        summary: describeToolCall(toolUse),
      });
      return {
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: output,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await writeAuditLog({
        agencyId: actor.agencyId,
        clientId,
        actionTypeCode: code,
        riskLevel: "low",
        status: "failed",
        summary: describeToolCall(toolUse),
      });
      return rejectResult(
        toolUse.id,
        `Error al ejecutar ${toolUse.name}: ${message}`,
      );
    }
  }

  // 5. High branch — execution is NOT attempted. The proposal is queued for
  // a human decision and the model is told plainly that nothing happened
  // yet (SEG-09: never claim an action happened when it did not).
  const approvalId = await withSystemWebhookContext(
    actor.agencyId,
    async (tx) => {
      const inserted = await tx
        .insert(approvalQueue)
        .values({
          agencyId: actor.agencyId,
          clientId,
          actionTypeCode: code,
          riskLevel: "high",
          toolName: toolUse.name,
          toolUseId: toolUse.id,
          toolInput: toolUse.input,
          status: "pending",
          summary: describeToolCall(toolUse),
          requestedByIdentityType: actor.identity.type,
          requestedByIdentityId: requestedByIdentityId(actor.identity),
          channel: actor.channel,
          conversationPhoneNumber: actor.counterpartPhoneNumber,
        })
        // A retried Inngest step must not enqueue the same proposal twice —
        // idempotent on the (agency_id, tool_use_id) unique index.
        .onConflictDoNothing({
          target: [approvalQueue.agencyId, approvalQueue.toolUseId],
        })
        .returning({ id: approvalQueue.id });

      if (inserted[0]) return inserted[0].id;

      // The insert was a no-op (conflict) — a retried step reuses the
      // existing row's id rather than losing track of it.
      const [existing] = await tx
        .select({ id: approvalQueue.id })
        .from(approvalQueue)
        .where(
          and(
            eq(approvalQueue.agencyId, actor.agencyId),
            eq(approvalQueue.toolUseId, toolUse.id),
          ),
        );
      return existing.id;
    },
  );

  await writeAuditLog({
    agencyId: actor.agencyId,
    clientId,
    actionTypeCode: code,
    riskLevel: "high",
    status: "pending_approval",
    approvalId,
    summary: describeToolCall(toolUse),
  });

  return {
    type: "tool_result",
    tool_use_id: toolUse.id,
    content:
      "Esta acción requiere aprobación del equipo antes de ejecutarse. Quedó en la cola de aprobación y el equipo la va a revisar.",
  };
}
