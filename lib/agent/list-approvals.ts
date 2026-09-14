import "server-only";
import { desc, eq, ne } from "drizzle-orm";
import { agentActionCatalog } from "@/lib/db/schema/agent-action-catalog";
import { approvalQueue } from "@/lib/db/schema/approval-queue";
import { clients } from "@/lib/db/schema/clients";
import { withTenantContext } from "@/lib/tenant/with-tenant-context";

/**
 * SEG-10's read side, for the bitácora page (plan 04-11). Same LD-17 shape
 * as `lib/audit/list-audit-log.ts`: only `withTenantContext` decides scope,
 * enforced entirely by `approval_queue_select_by_role` (migration 0016). No
 * `client_id` predicate and no `app.role` branch exists in this file.
 *
 * The `status = 'pending'` / `status <> 'pending'` filters below are NOT a
 * second scope check — they narrow WHICH of the rows a member can already
 * see, exactly like any other WHERE clause narrows a SELECT. LD-17's
 * prohibition is specifically about re-deriving the client/role boundary
 * RLS already owns, which neither function does.
 */

export type PendingApproval = {
  id: string;
  createdAt: Date;
  summary: string;
  toolName: string;
  actionLabel: string;
  clientName: string | null;
  channel: string;
};

export async function listPendingApprovals(): Promise<PendingApproval[]> {
  const rows = await withTenantContext((tx) =>
    tx
      .select({
        id: approvalQueue.id,
        createdAt: approvalQueue.createdAt,
        summary: approvalQueue.summary,
        toolName: approvalQueue.toolName,
        actionTypeCode: approvalQueue.actionTypeCode,
        actionLabel: agentActionCatalog.label,
        clientName: clients.name,
        channel: approvalQueue.channel,
      })
      .from(approvalQueue)
      .leftJoin(agentActionCatalog, eq(approvalQueue.actionTypeCode, agentActionCatalog.code))
      .leftJoin(clients, eq(approvalQueue.clientId, clients.id))
      .where(eq(approvalQueue.status, "pending"))
      .orderBy(desc(approvalQueue.createdAt)),
  );

  // Same LEFT JOIN nullability note as list-audit-log.ts: `action_type_code`
  // is a NOT NULL FK into the static `agent_action_catalog`, so this
  // fallback is defensive, not an expected path.
  return rows.map(({ actionTypeCode, actionLabel, ...row }) => ({
    ...row,
    actionLabel: actionLabel ?? actionTypeCode,
  }));
}

export type DecidedApproval = PendingApproval & {
  status: string;
  decidedAt: Date | null;
  executionResult: string | null;
};

export async function listRecentDecidedApprovals(limit = 25): Promise<DecidedApproval[]> {
  const rows = await withTenantContext((tx) =>
    tx
      .select({
        id: approvalQueue.id,
        createdAt: approvalQueue.createdAt,
        summary: approvalQueue.summary,
        toolName: approvalQueue.toolName,
        actionTypeCode: approvalQueue.actionTypeCode,
        actionLabel: agentActionCatalog.label,
        clientName: clients.name,
        channel: approvalQueue.channel,
        status: approvalQueue.status,
        decidedAt: approvalQueue.decidedAt,
        executionResult: approvalQueue.executionResult,
      })
      .from(approvalQueue)
      .leftJoin(agentActionCatalog, eq(approvalQueue.actionTypeCode, agentActionCatalog.code))
      .leftJoin(clients, eq(approvalQueue.clientId, clients.id))
      .where(ne(approvalQueue.status, "pending"))
      .orderBy(desc(approvalQueue.createdAt))
      .limit(limit),
  );

  return rows.map(({ actionTypeCode, actionLabel, ...row }) => ({
    ...row,
    actionLabel: actionLabel ?? actionTypeCode,
  }));
}
