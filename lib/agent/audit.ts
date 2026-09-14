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
 *
 * Generates `id` in application code and skips `.returning()` deliberately
 * (found live against real Postgres in plan 04-12, not caught by 0014/0016
 * typechecking against a schema that has no way to express this): Postgres
 * treats a RETURNING clause on INSERT as also requiring the new row to pass
 * the table's SELECT policy, or the whole statement errors with "new row
 * violates row-level security policy" — even though the INSERT's own WITH
 * CHECK passed. `audit_log_select_by_role` (0014) is deliberately team-only
 * (admin/member `app.role`) and grants the `system_webhook` actor no read
 * access at all — by design, the webhook actor is INSERT-only here (see the
 * migration's own header). `.returning()` therefore made every write fail,
 * not just reads. `defaultRandom()` on the column already lets the database
 * generate `id`; generating it here instead, and never selecting the row
 * back, keeps that design and just avoids asking Postgres to read what the
 * policy says this actor may never see.
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

  const id = crypto.randomUUID();

  await withSystemWebhookContext(agencyId, (tx) =>
    tx.insert(auditLog).values({
      id,
      agencyId,
      clientId,
      actionTypeCode,
      riskLevel,
      summary,
      status,
      approvalId: approvalId ?? null,
    }),
  );

  return id;
}
