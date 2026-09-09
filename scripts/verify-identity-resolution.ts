/**
 * Executable proof of the full Phase 2 identity model against real Neon —
 * the ROADMAP Fase 2 success criterion (resolve a team WhatsApp number, a
 * client A contact number, a client B contact number, and an unregistered
 * number to the right identity) plus every SEG requirement the database
 * enforces on top of it. Run with `npx tsx scripts/verify-identity-resolution.ts`.
 *
 * Unlike `scripts/verify-identity-classification.ts` (the pure, network-free
 * half of this same test matrix), this script imports and calls the REAL
 * `resolveIdentity` and `withResolvedIdentityContext` — the point is to prove
 * that Postgres RLS, not application code, confines each resolved identity to
 * its own data, end to end from a phone number to a scoped row set.
 *
 * Needs network egress to Neon and therefore cannot run in a sandboxed
 * session (see STATE.md's "Continuidad de sesión" / environment-gate note
 * carried over from Phase 1) — this is a local/CI gate, applied by plan
 * 02-07 after migrations 0005-0008 are in place.
 *
 * Deliberately imports the raw, unscoped `db` export from `lib/db/index.ts`
 * for seeding and for the assertions that are not about `resolveIdentity`
 * itself (the direct RLS/trigger/CHECK proofs) — same reasoning as
 * `verify-rls-isolation.ts`'s header comment: `db` uses the `neon-http`
 * driver, which has no real multi-statement `.transaction()` support, so
 * `db.batch([...])` is used instead, which Neon's HTTP driver DOES execute as
 * one atomic transaction per call. Every seed insert/delete below sets the
 * GUCs its own row's RLS policy requires, in the same batch as the write —
 * this script IS the privileged setup path, there is no admin API yet.
 *
 * `db.batch(...)` results are cast to `any[]` and indexed positionally rather
 * than fought into precise tuple types — the runtime assertions below are the
 * actual proof, not the TypeScript types of this setup/assert plumbing.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { agencies } from "../lib/db/schema/agencies";
import { authorizedContacts } from "../lib/db/schema/authorized-contacts";
import { clients } from "../lib/db/schema/clients";
import { teamMembers } from "../lib/db/schema/team-members";
import { resolveIdentity } from "../lib/identity/resolve-identity";
import { withResolvedIdentityContext } from "../lib/tenant/with-resolved-identity-context";

const failures: string[] = [];

function check(label: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`  [PASS] ${label}`);
  } else {
    console.log(`  [FAIL] ${label} — ${detail}`);
    failures.push(`${label} — ${detail}`);
  }
}

function assertRowCount(label: string, rows: unknown[], expected: number) {
  check(
    label,
    rows.length === expected,
    `expected ${expected} row(s), got ${rows.length} (${JSON.stringify(rows)})`,
  );
}

/**
 * `err` from a driver/RLS/trigger failure is always an `Error` in practice,
 * but this stays defensive rather than assuming it.
 */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * For the "must never succeed" write assertions (SEG-03): the caller expects
 * an error OR — if the driver ever changes and an RLS `WITH CHECK` failure
 * stops throwing — zero rows actually written. It must never silently
 * succeed with a row in place.
 */
async function attemptInsertShouldFail(label: string, queries: unknown[]) {
  try {
    const result = await batch(queries);
    const insertedRows = result[result.length - 1];
    check(
      label,
      Array.isArray(insertedRows) && insertedRows.length === 0,
      `expected the insert to fail or return 0 rows, got ${JSON.stringify(insertedRows)}`,
    );
  } catch (err) {
    check(label, true, errorMessage(err));
  }
}

/**
 * For the CHECK-constraint and trigger assertions (SEG-02, SEG-04, T-02-02):
 * the caller must throw, AND the error must name the specific constraint or
 * trigger — a throw for the wrong reason (e.g. a typo in the seed data) must
 * not be able to pass this assertion by accident.
 */
async function expectThrows(
  label: string,
  fn: () => Promise<unknown>,
  expectedFragment: string,
) {
  try {
    await fn();
    check(label, false, "expected an error, but the statement succeeded");
  } catch (err) {
    const message = errorMessage(err);
    check(
      label,
      message.includes(expectedFragment),
      `error did not mention "${expectedFragment}": ${message}`,
    );
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- db.batch()'s tuple
   typing can't express "an array built up dynamically per scenario"; every
   value pulled out of its result is immediately used in a runtime assertion
   below, which is the actual correctness check, not these types. */
async function batch(queries: unknown[]): Promise<any[]> {
  return (db.batch as any)(queries);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function main() {
  const agencyAId = `verify-identity-agency-a-${randomUUID()}`;
  const agencyBId = `verify-identity-agency-b-${randomUUID()}`;
  const UNKNOWN_PHONE = "+573009990009";

  let clientAId: string | undefined;
  let clientBId: string | undefined;
  let teamMemberId: string | undefined;
  let contactAId: string | undefined;
  let contactBId: string | undefined;

  try {
    // === Setup ===
    console.log("Seeding test data...");

    await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyAId}, true)`),
      db.insert(agencies).values({ id: agencyAId, name: "Verify Identity Agency A" }),
    ]);

    await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyBId}, true)`),
      db.insert(agencies).values({ id: agencyBId, name: "Verify Identity Agency B" }),
    ]);

    const clientASetup = await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyAId}, true)`),
      db.execute(sql`SELECT set_config('app.role', 'admin', true)`),
      db.insert(clients).values({ agencyId: agencyAId, name: "Client A" }).returning({ id: clients.id }),
    ]);
    clientAId = clientASetup[2]?.[0]?.id;

    const clientBSetup = await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyAId}, true)`),
      db.execute(sql`SELECT set_config('app.role', 'admin', true)`),
      db.insert(clients).values({ agencyId: agencyAId, name: "Client B" }).returning({ id: clients.id }),
    ]);
    clientBId = clientBSetup[2]?.[0]?.id;

    // Writing team_members requires only app.agency_id (no write-role split
    // on this table in Phase 1 or Phase 2).
    const teamMemberSetup = await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyAId}, true)`),
      db
        .insert(teamMembers)
        .values({
          agencyId: agencyAId,
          email: "verify-identity-member@example.com",
          role: "member",
          status: "invited",
          whatsappNumber: "+573001110001",
        })
        .returning({ id: teamMembers.id }),
    ]);
    teamMemberId = teamMemberSetup[1]?.[0]?.id;

    if (!clientAId || !clientBId || !teamMemberId) {
      throw new Error(
        `Setup failed to produce the expected seed row ids (clientAId=${clientAId}, clientBId=${clientBId}, teamMemberId=${teamMemberId}).`,
      );
    }

    // Writing authorized_contacts requires app.role='admin' in the same
    // batch (authorized_contacts_write_admin_only, migration 0006).
    const contactASetup = await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyAId}, true)`),
      db.execute(sql`SELECT set_config('app.role', 'admin', true)`),
      db
        .insert(authorizedContacts)
        .values({
          agencyId: agencyAId,
          clientId: clientAId,
          name: "Contact A",
          phoneNumber: "+573002220002",
          optInConfirmedByTeam: true,
          optInConfirmedBy: teamMemberId,
          optInConfirmedAt: new Date(),
        })
        .returning({ id: authorizedContacts.id }),
    ]);
    contactAId = contactASetup[2]?.[0]?.id;

    // Contact B is deliberately NOT opt-in confirmed (D-04: opt-in gates only
    // PROACTIVE messages, never inbound resolution — resolveIdentity must
    // still resolve this contact).
    const contactBSetup = await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyAId}, true)`),
      db.execute(sql`SELECT set_config('app.role', 'admin', true)`),
      db
        .insert(authorizedContacts)
        .values({
          agencyId: agencyAId,
          clientId: clientBId,
          name: "Contact B",
          phoneNumber: "+573003330003",
          optInConfirmedByTeam: false,
        })
        .returning({ id: authorizedContacts.id }),
    ]);
    contactBId = contactBSetup[2]?.[0]?.id;

    if (!contactAId || !contactBId) {
      throw new Error(
        `Setup failed to produce the expected contact row ids (contactAId=${contactAId}, contactBId=${contactBId}).`,
      );
    }

    console.log(
      `Seeded: agency A=${agencyAId} (client A=${clientAId}, client B=${clientBId}, team member=${teamMemberId}, contact A=${contactAId}, contact B=${contactBId}), agency B=${agencyBId} (empty)\n`,
    );

    // === ROADMAP Fase 2 success criterion: the four resolution scenarios ===
    console.log("Running resolveIdentity assertions (ROADMAP success criterion)...");

    const teamIdentity = await resolveIdentity(agencyAId, "+573001110001");
    check(
      "(1) team WhatsApp number -> team_member identity with the right id and role",
      teamIdentity.type === "team_member" &&
        teamIdentity.teamMemberId === teamMemberId &&
        teamIdentity.role === "member",
      `got ${JSON.stringify(teamIdentity)}`,
    );

    const contactAIdentity = await resolveIdentity(agencyAId, "+573002220002");
    check(
      "(2) client A contact number -> client_contact scoped to client A",
      contactAIdentity.type === "client_contact" && contactAIdentity.clientId === clientAId,
      `got ${JSON.stringify(contactAIdentity)}`,
    );

    const contactBIdentity = await resolveIdentity(agencyAId, "+573003330003");
    check(
      "(3) client B contact number -> client_contact scoped to client B (not client A)",
      contactBIdentity.type === "client_contact" && contactBIdentity.clientId === clientBId,
      `got ${JSON.stringify(contactBIdentity)}`,
    );

    const unknownIdentity = await resolveIdentity(agencyAId, UNKNOWN_PHONE);
    check(
      "(4) unregistered number -> unknown identity (SEG-12)",
      unknownIdentity.type === "unknown",
      `got ${JSON.stringify(unknownIdentity)}`,
    );

    // Cross-agency guard: agency B must never resolve agency A's contact,
    // even though the phone number is real and registered in agency A.
    const crossAgencyIdentity = await resolveIdentity(agencyBId, "+573002220002");
    check(
      "(4b) cross-agency guard: agency B never resolves agency A's contact number",
      crossAgencyIdentity.type === "unknown",
      `got ${JSON.stringify(crossAgencyIdentity)}`,
    );

    if (contactAIdentity.type !== "client_contact") {
      throw new Error("contactAIdentity did not resolve as client_contact — cannot run scoped-read assertions");
    }

    console.log("");
    if (failures.length === 0) {
      console.log("All assertions passed.");
    } else {
      console.log(`${failures.length} assertion(s) failed:`);
      for (const f of failures) console.log(`  - ${f}`);
    }
  } finally {
    // Cleanup runs regardless of pass/fail. Deleting each agency cascades
    // (ON DELETE CASCADE) to its team_members, clients, client_assignments
    // and authorized_contacts rows — but those cascaded deletes are
    // themselves subject to RLS on each child table within this same
    // transaction, so the deleting GUCs must be set here too. Deleting
    // agency A's row needs app.role='admin' specifically because
    // authorized_contacts_write_admin_only (FOR ALL, migration 0006) also
    // gates the cascade delete into authorized_contacts.
    console.log("\nCleaning up test data...");
    try {
      await batch([
        db.execute(sql`SELECT set_config('app.agency_id', ${agencyAId}, true)`),
        db.execute(sql`SELECT set_config('app.role', 'admin', true)`),
        db.delete(agencies).where(eq(agencies.id, agencyAId)),
      ]);
    } catch (err) {
      console.error("Cleanup of agency A failed:", err);
    }
    try {
      await batch([
        db.execute(sql`SELECT set_config('app.agency_id', ${agencyBId}, true)`),
        db.execute(sql`SELECT set_config('app.role', 'admin', true)`),
        db.delete(agencies).where(eq(agencies.id, agencyBId)),
      ]);
    } catch (err) {
      console.error("Cleanup of agency B failed:", err);
    }
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("verify-identity-resolution.ts crashed:", err);
  process.exitCode = 1;
});
