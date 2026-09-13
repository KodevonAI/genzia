import { auditLog } from "@/lib/db/schema/audit-log";
import { withSystemWebhookContext } from "@/lib/tenant/with-system-webhook-context";

/**
 * The ONLY writer of `audit_log` anywhere in this codebase. Every agent
 * action — executed immediately or merely proposed and queued — goes through
 * this one function, which is what makes SEG-11's "toda acción del agente
 * queda registrada" true by construction rather than by discipline (a caller
 * that forgets to log is impossible if there is only one way to log).
 *
 * LD-11: writes as the system actor via `withSystemWebhookContext`, never
 * through the caller's own resolved-identity scope — a `client_contact`'s
 * turn must not be able to author its own audit trail. Migration 0014's
 * INSERT policy on `audit_log` enforces this at the database level; this
 * function is the only application-code path that can satisfy it.
 */
export type AuditStatus =
  | "executed"
  | "pending_approval"
  | "approved_executed"
  | "rejected"
  | "failed";

export async function writeAuditLog(params: {
  agencyId: string;
  clientId: string | null;
  actionTypeCode: string;
  riskLevel: "low" | "high";
  summary: string;
  status: AuditStatus;
  approvalId?: string | null;
}): Promise<string> {
  const {
    agencyId,
    clientId,
    actionTypeCode,
    riskLevel,
    summary,
    status,
    approvalId,
  } = params;

  const [row] = await withSystemWebhookContext(agencyId, (tx) =>
    tx
      .insert(auditLog)
      .values({
        agencyId,
        clientId,
        actionTypeCode,
        riskLevel,
        summary,
        status,
        approvalId: approvalId ?? null,
      })
      .returning({ id: auditLog.id }),
  );

  return row.id;
}
