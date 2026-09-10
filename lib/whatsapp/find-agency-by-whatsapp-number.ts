import { sql } from "drizzle-orm";
import { identityDb } from "@/lib/tenant/with-resolved-identity-context";

/**
 * Cross-agency lookup for the shared internal number (WA-03/WA-04).
 *
 * `resolveIdentity(agencyId, phoneNumber)` requires `agencyId` as an input,
 * but the shared internal number's webhook does not know it yet — determining
 * the agency IS the first step of resolution here. `team_members` has FORCE
 * ROW LEVEL SECURITY and every policy on it requires `app.agency_id`, so a
 * normal query with no GUC set returns zero rows (RLS fails closed, by
 * design). This calls the one narrow SECURITY DEFINER function created for
 * exactly this purpose (drizzle/migrations/0013_whatsapp_messages_rls.sql),
 * which returns ONLY `agency_id` and nothing else.
 *
 * HARD CONSTRAINTS, both carried forward from 02-07-SUMMARY.md's open SEG-12
 * finding:
 *  - Never widen the SQL function, or add a fallback query here, to read
 *    `team_members` (or `authorized_contacts`) directly. The function is the
 *    only sanctioned path that reads `team_members` without an `app.agency_id`
 *    GUC already set.
 *  - This must run and RETURN before any `withResolvedIdentityContext` or
 *    `withSystemWebhookContext` scope opens — it has no agencyId yet, so it
 *    cannot run inside a scoped transaction.
 *
 * Reuses `identityDb` rather than opening another Postgres pool.
 */
export async function findAgencyByTeamWhatsAppNumber(
  phoneNumber: string,
): Promise<string | null> {
  const rows = await identityDb.execute<{ agency_id: string | null }>(
    sql`select find_agency_by_team_whatsapp_number(${phoneNumber}) as agency_id`,
  );
  const list = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
  const first = list[0] as { agency_id: string | null } | undefined;
  return first?.agency_id ?? null;
}
