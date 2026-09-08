/**
 * Network-free proof that `classifyIdentity` (lib/identity/classify-identity.ts)
 * returns the correct `ResolvedIdentity` variant for every row-shape
 * combination, covering the ROADMAP Fase 2 success criterion's four cases at
 * the pure-logic level: team number, client A number, client B number,
 * unknown number. Run with `npx tsx scripts/verify-identity-classification.ts`.
 *
 * Deliberately imports nothing from the database module, the tenant-context
 * module, or the ORM layer — this is the sandbox-safe half of the Phase 2
 * test suite (D-07). The database-backed half, which proves RLS actually
 * enforces the scope these identities imply, is
 * `scripts/verify-identity-resolution.ts` and requires real Neon access.
 */
import { classifyIdentity } from "../lib/identity/classify-identity";
import type { ResolvedIdentity } from "../lib/identity/types";

const failures: string[] = [];

function check(label: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`  [PASS] ${label}`);
  } else {
    console.log(`  [FAIL] ${label} — ${detail}`);
    failures.push(`${label} — ${detail}`);
  }
}

function assertIdentity(label: string, actual: ResolvedIdentity, expected: ResolvedIdentity) {
  check(
    label,
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

async function main() {
  console.log("Running classifyIdentity assertions (no network)...");

  // (1) team number -> admin
  assertIdentity(
    "(1) team_members row (admin) -> team_member identity",
    classifyIdentity({ id: "tm-1", role: "admin" }, null),
    { type: "team_member", teamMemberId: "tm-1", role: "admin" },
  );

  // (2) team number -> member
  assertIdentity(
    "(2) team_members row (member) -> team_member identity with member role",
    classifyIdentity({ id: "tm-2", role: "member" }, null),
    { type: "team_member", teamMemberId: "tm-2", role: "member" },
  );

  // (3) client A contact, opt-in confirmed
  assertIdentity(
    "(3) authorized_contacts row for client A -> client_contact scoped to client A",
    classifyIdentity(null, { id: "c-1", clientId: "cli-A", optInConfirmedByTeam: true }),
    { type: "client_contact", contactId: "c-1", clientId: "cli-A", optInConfirmedByTeam: true },
  );

  // (4) client B contact, opt-in NOT confirmed — D-04: still resolves, opt-in
  // only gates PROACTIVE messages, never inbound resolution.
  assertIdentity(
    "(4) authorized_contacts row for client B without opt-in -> still client_contact, scoped to client B",
    classifyIdentity(null, { id: "c-2", clientId: "cli-B", optInConfirmedByTeam: false }),
    { type: "client_contact", contactId: "c-2", clientId: "cli-B", optInConfirmedByTeam: false },
  );

  // (5) unknown number -> SEG-12
  assertIdentity(
    "(5) no row in either table -> unknown identity (SEG-12)",
    classifyIdentity(null, null),
    { type: "unknown" },
  );

  // (6) precedence guard: both rows present -> team_member wins, deterministically
  assertIdentity(
    "(6) both rows present -> team_member wins (documented precedence)",
    classifyIdentity({ id: "tm-3", role: "member" }, { id: "c-3", clientId: "cli-A", optInConfirmedByTeam: true }),
    { type: "team_member", teamMemberId: "tm-3", role: "member" },
  );

  // (7) client A and client B contacts never collapse to the same scope —
  // the cross-client isolation invariant at the classification layer.
  const a = classifyIdentity(null, { id: "c-1", clientId: "cli-A", optInConfirmedByTeam: true });
  const b = classifyIdentity(null, { id: "c-2", clientId: "cli-B", optInConfirmedByTeam: true });
  check(
    "(7) client A and client B resolve to different clientId scopes",
    a.type === "client_contact" && b.type === "client_contact" && a.clientId !== b.clientId,
    `got a=${JSON.stringify(a)}, b=${JSON.stringify(b)}`,
  );

  console.log("");
  if (failures.length === 0) {
    console.log("All assertions passed.");
  } else {
    console.log(`${failures.length} assertion(s) failed:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("verify-identity-classification.ts crashed:", err);
  process.exitCode = 1;
});
