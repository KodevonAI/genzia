import { sql } from "drizzle-orm";
import { identityDb, type IdentityTx } from "@/lib/tenant/with-resolved-identity-context";

/**
 * The third and narrowest tenant scope in this codebase, after
 * `withTenantContext` (Clerk session) and `withResolvedIdentityContext`
 * (phone-number-resolved identity). It exists for exactly one caller: the
 * Meta webhook pipeline writing to and reading back from `messages`.
 *
 * Why it exists (Phase 3 DEC-A, resolving the open design point PATTERNS.md
 * flagged): D-04 requires the inbound row for an UNKNOWN sender to be
 * persisted. `withResolvedIdentityContext` for an `unknown` identity sets
 * only `app.agency_id` — which is byte-for-byte indistinguishable, at the
 * GUC level, from the SEG-12 read pattern 02-07-SUMMARY.md warns against.
 * Rather than weakening `messages`'s RLS so an unknown scope can write (which
 * would also let an unknown scope READ every message in the agency), the
 * webhook announces itself with a separate GUC, `app.actor`, that no other
 * table's policy references. RLS can then allow the webhook's agency-scoped
 * write while an `unknown` identity scope still reads zero rows from
 * `messages`. See drizzle/migrations/0013_whatsapp_messages_rls.sql.
 *
 * GUC contract:
 *   app.agency_id  always set — tenant containment, never bypassed
 *   app.actor      always the literal 'system_webhook'
 * Nothing else. In particular NO `app.role`: this is not a staff session and
 * must never satisfy an admin/member policy branch on any other table.
 *
 * INVARIANT (SEG-12, carried forward open from 02-07-SUMMARY.md): callers
 * must never query `team_members` or `authorized_contacts` inside this scope.
 * Sender identity is resolved BEFORE the scope opens, by
 * `resolveIdentity()`, and passed in as plain data.
 *
 * `set_config(..., true)` is transaction-local, not session-local: this
 * connects through Neon's pooler, so a session-local GUC would leak into an
 * unrelated later request reusing the same physical connection.
 *
 * Reuses `identityDb` rather than opening a pool of its own — a third
 * Postgres pool would be pure overhead. No `import "server-only"`, for the
 * same reason `with-resolved-identity-context.ts` omits it:
 * `scripts/verify-whatsapp-webhook.ts` imports this module under plain `tsx`,
 * where `server-only` resolves to its throwing entrypoint.
 */
export async function withSystemWebhookContext<T>(
  agencyId: string,
  fn: (tx: IdentityTx) => Promise<T>,
): Promise<T> {
  return identityDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.agency_id', ${agencyId}, true)`);
    await tx.execute(sql`SELECT set_config('app.actor', 'system_webhook', true)`);
    return fn(tx);
  });
}
