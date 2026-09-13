/**
 * Network-free proof that `buildSystemPrompt` (lib/agent/system-prompt.ts)
 * carries `AI_DISCLOSURE_RULE` verbatim in every identity branch (SEG-09,
 * T-04-08) and that the client_contact branch never describes agency-wide
 * or multi-client scope (SEG-07/SEG-08). Run with
 * `npx tsx scripts/verify-agent-prompt.ts` (also `npm run verify:agent-prompt`).
 *
 * Same offline, no-DB, no-network `check()` harness style as
 * scripts/verify-identity-classification.ts (D-07's sandbox-safe half of
 * the test suite).
 */
import { buildSystemPrompt } from "../lib/agent/system-prompt";
import { AI_DISCLOSURE_RULE } from "../lib/identity/disclosure";
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

async function main() {
  console.log("Running buildSystemPrompt assertions (no network)...");

  const admin: ResolvedIdentity = {
    type: "team_member",
    teamMemberId: "tm-1",
    role: "admin",
  };
  const member: ResolvedIdentity = {
    type: "team_member",
    teamMemberId: "tm-2",
    role: "member",
  };
  const clientContact: ResolvedIdentity = {
    type: "client_contact",
    contactId: "c-1",
    clientId: "cli-A",
    optInConfirmedByTeam: true,
  };
  const unknown: ResolvedIdentity = { type: "unknown" };

  const brand = { agentName: "Sofía", tone: "cercano y profesional" };

  const adminPrompt = buildSystemPrompt(admin, brand);
  const memberPrompt = buildSystemPrompt(member, brand);
  const clientPrompt = buildSystemPrompt(clientContact, brand);
  const unknownPrompt = buildSystemPrompt(unknown, brand);

  // (1)-(4): SEG-09 is unconditional across every identity branch.
  check(
    "(1) team_member/admin prompt contains AI_DISCLOSURE_RULE verbatim",
    adminPrompt.includes(AI_DISCLOSURE_RULE),
    "disclosure rule missing from admin prompt",
  );
  check(
    "(2) team_member/member prompt contains AI_DISCLOSURE_RULE verbatim",
    memberPrompt.includes(AI_DISCLOSURE_RULE),
    "disclosure rule missing from member prompt",
  );
  check(
    "(3) client_contact prompt contains AI_DISCLOSURE_RULE verbatim",
    clientPrompt.includes(AI_DISCLOSURE_RULE),
    "disclosure rule missing from client_contact prompt",
  );
  check(
    "(4) unknown identity prompt contains AI_DISCLOSURE_RULE verbatim",
    unknownPrompt.includes(AI_DISCLOSURE_RULE),
    "disclosure rule missing from unknown prompt",
  );

  // (5) SEG-07/SEG-08: a client contact's prompt must never grant
  // agency-wide or other-client scope.
  check(
    "(5) client_contact prompt contains no agency-wide scope grant",
    !clientPrompt.includes("todos los clientes"),
    "client_contact prompt must never contain 'todos los clientes'",
  );

  // (6) admin branch is the one place agency-wide scope IS granted.
  check(
    "(6) team_member/admin prompt DOES grant agency-wide scope",
    adminPrompt.includes("todos los clientes"),
    "admin prompt should state access to all of the agency's clients",
  );

  // (7) member branch: assigned-clients-only scope, explicit "say so" instruction.
  check(
    "(7) team_member/member prompt scopes to assigned clients only",
    memberPrompt.includes("clientes que te fueron asignados"),
    "member prompt missing assigned-clients-only scope text",
  );

  // (8) SEG-12: unknown identity states no account data, prospect/conversion mode.
  check(
    "(8) unknown identity prompt states no account data + prospect/conversion mode",
    unknownPrompt.includes("No tienes acceso a ningún dato de cuenta") &&
      unknownPrompt.toLowerCase().includes("prospecto"),
    "unknown prompt missing SEG-12 no-account-data / prospect-conversion framing",
  );

  // (9)-(10): null agentName/tone must degrade to a neutral default, never
  // the literal string "null".
  const nullBrandPrompt = buildSystemPrompt(unknown, {
    agentName: null,
    tone: null,
  });
  check(
    "(9) null agentName/tone produces a usable prompt, no literal 'null'",
    !/\bnull\b/i.test(nullBrandPrompt),
    `prompt contains a literal "null": ${nullBrandPrompt.slice(0, 120)}...`,
  );
  check(
    "(10) null agentName/tone prompt still contains AI_DISCLOSURE_RULE verbatim",
    nullBrandPrompt.includes(AI_DISCLOSURE_RULE),
    "disclosure rule missing when brand fields are null",
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
  console.error("verify-agent-prompt.ts crashed:", err);
  process.exitCode = 1;
});
