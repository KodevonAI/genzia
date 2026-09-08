/**
 * Executable proof that Postgres RLS alone — independent of any application
 * code — makes cross-agency and cross-role data leakage on `clients`
 * impossible. Run with `npx tsx scripts/verify-rls-isolation.ts`.
 *
 * Deliberately imports the raw, unscoped `db` export from `lib/db/index.ts`,
 * never `withTenantContext` — the point is to prove RLS itself blocks
 * access, not that the application's wrapper remembers to scope queries.
 * `db` uses the `neon-http` driver, which has no real multi-statement
 * transaction support (`.transaction()` throws); this script instead uses
 * `db.batch([...])`, which Neon's HTTP driver DOES execute as one atomic
 * transaction per call — the exact mechanism this script needs, since each
 * scenario below is a fixed, known-upfront sequence (set session GUCs, then
 * query), not the arbitrary/dynamic query sequence `withTenantContext`
 * supports for real request handling. `db.batch(...)` results are cast to
 * `any[]` and indexed positionally rather than fought into precise tuple
 * types — the runtime assertions below are the actual proof, not the
 * TypeScript types of this setup/assert plumbing.
 *
 * Every seed insert/delete below sets the GUCs its own row's RLS policy
 * requires (this script IS the privileged setup path — there's no admin API
 * yet), in the same batch as the write, exactly the way production code
 * will do it via `withTenantContext`.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { agencies } from "../lib/db/schema/agencies";
import { clients } from "../lib/db/schema/clients";
import { teamMembers } from "../lib/db/schema/team-members";

type ClientRow = typeof clients.$inferSelect;

const failures: string[] = [];

function check(label: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`  [PASS] ${label}`);
  } else {
    console.log(`  [FAIL] ${label} — ${detail}`);
    failures.push(`${label} — ${detail}`);
  }
}

function assertRowCount(label: string, rows: ClientRow[], expected: number) {
  check(
    label,
    rows.length === expected,
    `expected ${expected} row(s), got ${rows.length} (ids: ${rows.map((r) => r.id).join(", ") || "none"})`,
  );
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
  const agencyAId = `verify-agency-a-${randomUUID()}`;
  const agencyBId = `verify-agency-b-${randomUUID()}`;
  let clientAId: string | undefined;
  let clientBId: string | undefined;
  let memberId: string | undefined;

  try {
    const who = await batch([db.execute(sql`SELECT current_user, session_user`)]);
    const whoRow = who[0]?.rows?.[0] ?? who[0]?.[0];
    console.log(
      `Connected as: ${JSON.stringify(whoRow)} — this must NOT be the role that owns the tables, or FORCE ROW LEVEL SECURITY has no effect and every assertion below would pass for the wrong reason (see <verification> in 01-PLAN.md for the ownership check via psql).\n`,
    );

    // === Setup ===
    console.log("Seeding test data...");

    await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyAId}, true)`),
      db.insert(agencies).values({ id: agencyAId, name: "Verify Agency A" }),
    ]);

    await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyBId}, true)`),
      db.insert(agencies).values({ id: agencyBId, name: "Verify Agency B" }),
    ]);

    const clientASetup = await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyAId}, true)`),
      db.execute(sql`SELECT set_config('app.role', 'admin', true)`),
      db.insert(clients).values({ agencyId: agencyAId, name: "Client A" }).returning({ id: clients.id }),
    ]);
    clientAId = clientASetup[2]?.[0]?.id;

    const clientBSetup = await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyBId}, true)`),
      db.execute(sql`SELECT set_config('app.role', 'admin', true)`),
      db.insert(clients).values({ agencyId: agencyBId, name: "Client B" }).returning({ id: clients.id }),
    ]);
    clientBId = clientBSetup[2]?.[0]?.id;

    const memberSetup = await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyAId}, true)`),
      db
        .insert(teamMembers)
        .values({
          agencyId: agencyAId,
          email: "verify-member@example.com",
          role: "member",
          status: "invited",
        })
        .returning({ id: teamMembers.id }),
    ]);
    memberId = memberSetup[1]?.[0]?.id;

    if (!clientAId || !clientBId || !memberId) {
      throw new Error(
        `Setup failed to produce the expected seed row ids (clientAId=${clientAId}, clientBId=${clientBId}, memberId=${memberId}).`,
      );
    }

    console.log(
      `Seeded: agency A=${agencyAId} (client ${clientAId}), agency B=${agencyBId} (client ${clientBId}), member=${memberId} (no client_assignments row)\n`,
    );

    // === Assertions ===
    console.log("Running isolation assertions...");

    // (a) No tenant context set at all. Must be zero rows, not an error and
    // not every row — proves current_setting(..., true) (missing-is-null)
    // is used throughout, not the error-on-missing form.
    const rowsNoContext = (await db.select().from(clients)) as ClientRow[];
    assertRowCount("(a) no GUCs set at all -> 0 rows", rowsNoContext, 0);

    // (b) Only app.agency_id set, no role, no team_member_id. Neither the
    // admin branch nor the assignment-lookup branch of the clients SELECT
    // policy can be satisfied, so this must also be zero rows.
    const agencyOnly = await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyAId}, true)`),
      db.select().from(clients),
    ]);
    assertRowCount(
      "(b) agency A context only (no role/team_member_id) -> 0 rows",
      agencyOnly[1],
      0,
    );

    // Positive control: agency A + role=admin sees exactly its own client.
    // Without this, a script that only ever asserts "0 rows" could pass
    // even if the policies blocked everything unconditionally (a
    // fail-closed bug that looks identical to success from the outside).
    const adminScenario = await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyAId}, true)`),
      db.execute(sql`SELECT set_config('app.role', 'admin', true)`),
      db.select().from(clients),
    ]);
    const rowsAdmin: ClientRow[] = adminScenario[2];
    assertRowCount("agency A admin -> sees exactly Client A", rowsAdmin, 1);
    check(
      "agency A admin -> the row IS Client A",
      rowsAdmin[0]?.id === clientAId,
      `got id ${rowsAdmin[0]?.id}, expected ${clientAId}`,
    );

    // (c) Agency A + the member's real team_member_id/role, and that member
    // has NO client_assignments row. Must be zero rows even though Client A
    // genuinely exists in the table — this is must_haves truth #4.
    const memberScenario = await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyAId}, true)`),
      db.execute(sql`SELECT set_config('app.role', 'member', true)`),
      db.execute(sql`SELECT set_config('app.team_member_id', ${memberId}, true)`),
      db.select().from(clients),
    ]);
    assertRowCount(
      "(c) agency A, unassigned member -> 0 rows despite Client A existing",
      memberScenario[3],
      0,
    );

    // Cross-agency isolation (must_haves truth #2): agency B's admin
    // context must see ONLY Client B, and Client A must never appear, even
    // though Client A is a real row and this connection is a real admin.
    const crossAgencyScenario = await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyBId}, true)`),
      db.execute(sql`SELECT set_config('app.role', 'admin', true)`),
      db.select().from(clients),
    ]);
    const rowsCrossAgency: ClientRow[] = crossAgencyScenario[2];
    assertRowCount("agency B admin -> sees exactly Client B", rowsCrossAgency, 1);
    check(
      "agency B admin -> Client A never appears",
      rowsCrossAgency.every((row) => row.id !== clientAId),
      `Client A (${clientAId}) leaked into agency B's result set`,
    );

    console.log("");
    if (failures.length === 0) {
      console.log("All assertions passed.");
    } else {
      console.log(`${failures.length} assertion(s) failed:`);
      for (const f of failures) console.log(`  - ${f}`);
    }
  } finally {
    // Cleanup runs regardless of pass/fail. Deleting each agency cascades
    // (ON DELETE CASCADE, see 0000_initial_schema.sql) to its team_members,
    // clients, client_assignments, and agent_brand_config rows — but those
    // cascaded deletes are themselves subject to RLS on each child table
    // within this same transaction, so the deleting GUCs (agency_id +
    // role=admin, for the `clients` FOR ALL policy) must be set here too.
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
  console.error("verify-rls-isolation.ts crashed:", err);
  process.exitCode = 1;
});
