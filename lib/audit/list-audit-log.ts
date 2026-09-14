import "server-only";
import { desc, eq } from "drizzle-orm";
import { agentActionCatalog } from "@/lib/db/schema/agent-action-catalog";
import { auditLog } from "@/lib/db/schema/audit-log";
import { clients } from "@/lib/db/schema/clients";
import { messages } from "@/lib/db/schema/messages";
import { withTenantContext } from "@/lib/tenant/with-tenant-context";

/**
 * The SEG-11 / SIS-01 readers: the bitácora page (plan 04-11) is the first
 * real consumer of `audit_log`, which migration 0006 explicitly deferred to
 * this phase, and the first reader of `messages` for team-visible history.
 *
 * LD-17 (locked decision, do not revisit): every read here goes through
 * `withTenantContext` and adds NO `client_id` predicate and NO `app.role`
 * branch of its own. What a given team member sees is decided entirely by
 * `audit_log_select_by_role` (migration 0014) and `messages_select_by_role`
 * (migration 0015) — duplicating that check here would mask a future policy
 * regression instead of catching it.
 *
 * Both functions LEFT JOIN `clients` rather than INNER JOIN: a client-scoped
 * row whose client name this member somehow couldn't see would otherwise
 * silently vanish from the list even though the row's own RLS policy already
 * decided it IS visible to them. In practice this can't happen — a visible
 * `audit_log`/`messages` row always has a visible `clients` row under the
 * matching three-branch convention (0007/0014/0015) — but the LEFT join
 * keeps that an invariant of the query shape, not an assumption baked into
 * an INNER join that would fail silently if the invariant ever broke.
 */

export type AuditEntry = {
  id: string;
  createdAt: Date;
  summary: string;
  status: string;
  riskLevel: string;
  actionLabel: string;
  clientName: string | null;
  approvalId: string | null;
};

export async function listAuditLog(limit = 100): Promise<AuditEntry[]> {
  const rows = await withTenantContext((tx) =>
    tx
      .select({
        id: auditLog.id,
        createdAt: auditLog.createdAt,
        summary: auditLog.summary,
        status: auditLog.status,
        riskLevel: auditLog.riskLevel,
        actionTypeCode: auditLog.actionTypeCode,
        actionLabel: agentActionCatalog.label,
        clientName: clients.name,
        approvalId: auditLog.approvalId,
      })
      .from(auditLog)
      .leftJoin(agentActionCatalog, eq(auditLog.actionTypeCode, agentActionCatalog.code))
      .leftJoin(clients, eq(auditLog.clientId, clients.id))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit),
  );

  // `actionLabel` is typed nullable only because it comes through a LEFT
  // JOIN — `action_type_code` is a NOT NULL FK into the static, row-locked
  // `agent_action_catalog` (D-01/D-02: three platform-global rows, never
  // deleted), so a real audit row always has a match. The fallback to the
  // raw code exists only so a future catalog change can't turn a missing
  // label into a blank line in the bitácora.
  return rows.map(({ actionTypeCode, actionLabel, ...row }) => ({
    ...row,
    actionLabel: actionLabel ?? actionTypeCode,
  }));
}

export type ConversationEntry = {
  id: string;
  createdAt: Date;
  direction: string;
  channel: string;
  messageType: string;
  textBody: string | null;
  clientName: string | null;
};

export async function listRecentConversationMessages(limit = 100): Promise<ConversationEntry[]> {
  return withTenantContext((tx) =>
    tx
      .select({
        id: messages.id,
        createdAt: messages.createdAt,
        direction: messages.direction,
        channel: messages.channel,
        messageType: messages.messageType,
        textBody: messages.textBody,
        clientName: clients.name,
      })
      .from(messages)
      .leftJoin(clients, eq(messages.clientId, clients.id))
      .orderBy(desc(messages.createdAt))
      .limit(limit),
  );
}

/**
 * The client ficha's own conversation-history reader (Phase 5 CRM):
 * `listRecentConversationMessages`'s exact shape, with exactly one added
 * predicate (`clientId`), still through `withTenantContext`, still no
 * `app.role` branch of its own — same LD-17 posture as every other reader
 * in this file. `clientName` is kept in the projection for shape
 * consistency with `ConversationEntry`; it will always equal the ficha's
 * own client here, which is harmless.
 */
export async function listConversationMessagesForClient(
  clientId: string,
  limit = 100,
): Promise<ConversationEntry[]> {
  return withTenantContext((tx) =>
    tx
      .select({
        id: messages.id,
        createdAt: messages.createdAt,
        direction: messages.direction,
        channel: messages.channel,
        messageType: messages.messageType,
        textBody: messages.textBody,
        clientName: clients.name,
      })
      .from(messages)
      .leftJoin(clients, eq(messages.clientId, clients.id))
      .where(eq(messages.clientId, clientId))
      .orderBy(desc(messages.createdAt))
      .limit(limit),
  );
}
