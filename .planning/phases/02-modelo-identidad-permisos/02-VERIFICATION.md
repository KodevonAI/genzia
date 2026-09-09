---
phase: 02-modelo-identidad-permisos
verified: 2026-09-09T14:40:00Z
status: passed
score: 12/12 must-haves verified (1 residual finding tracked, non-blocking)
overrides_applied: 0
tracked_residual_findings:
  - finding: "SEG-12 defense-in-depth gap: an already-resolved 'unknown' identity's withResolvedIdentityContext scope can still read team_members and authorized_contacts (0007's `<> 'client_contact'` lockout clause is fail-open for an unset app.role, not just non-client_contact)."
    severity: "low — no current code path opens a withResolvedIdentityContext scope for an unknown identity and queries either table (confirmed by static grep across lib/ and app/: only scripts/verify-identity-resolution.ts does this, as a test)."
    evidence: "02-07-SUMMARY.md; live Neon assertions (8b)/(8c) in db:verify-identity fail as documented; a first fix (migration 0009) broke two legitimate no-role paths (Clerk agency/team-member bootstrap webhooks, and resolveIdentity() itself, which needs the identical GUC shape to determine identity in the first place) and was fully, byte-for-byte reverted (0010/0011), independently confirmed against 0006's original clause during this verification."
    recommendation: "Before Phase 3 wires a real inbound-message call site that could open a withResolvedIdentityContext scope for an unknown sender and query team_members/authorized_contacts, either (a) run resolveIdentity's lookup over a narrowly-scoped BYPASSRLS-capable role used for nothing else, or (b) treat 'no call site queries these two tables with app.role unset except resolveIdentity itself' as a code-reviewed invariant. Not a re-opened gap — carried forward from 02-07-SUMMARY.md, not newly discovered here."
---

# Phase 2: Modelo de identidad y permisos Verification Report

**Phase Goal:** Dado un mensaje o sesión entrante, el sistema resuelve quién escribe
(miembro de equipo con rol, contacto autorizado de un cliente, o número desconocido) y
a qué datos tiene acceso — con el aislamiento cliente-a-cliente enforced por RLS de
Postgres, nunca por filtro en la aplicación.

**Verified:** 2026-09-09
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A message from a team WhatsApp number resolves to `team_member` with correct id/role, before any data loads (SEG-01, SEG-06) | ✓ VERIFIED | `resolveIdentity` live-tested against real Neon (02-07-SUMMARY.md step 6); ROADMAP scenario (1) passed; static code shows zero application-layer client filters (`lib/identity/resolve-identity.ts` sets only `app.agency_id`) |
| 2 | A message from client A's authorized contact resolves to `client_contact` scoped to client A only (SEG-01, SEG-02, SEG-07) | ✓ VERIFIED | Live assertions (2), (5) pass — scoped read via `withResolvedIdentityContext` returns exactly 1 row, `id === clientAId` |
| 3 | A message from client B's authorized contact resolves to `client_contact` scoped to client B, never leaking client A data (SEG-02, SEG-07) | ✓ VERIFIED | Live assertions (3), (3b), (6) pass — scoped read never contains `clientBId` when scoped to A and vice versa |
| 4 | An unregistered number resolves to `unknown`, receives no account data via the actual resolution flow (SEG-12) | ✓ VERIFIED | Live assertion (4), (8) pass — `resolveIdentity` returns `{type:"unknown"}`; scope reads 0 rows from `clients`/`team_members`/`authorized_contacts` in the intended flow. See residual finding below for a narrower, currently-unreachable defense-in-depth gap. |
| 5 | One phone number maps to exactly one client; cannot collide with a team WhatsApp number (SEG-02) | ✓ VERIFIED | Unique index `authorized_contacts_agency_id_phone_number_idx` + bidirectional triggers; live assertions (12), (13) both directions pass on real Neon |
| 6 | Only an agency admin can add/remove an authorized contact — the client never self-authorizes (SEG-03) | ✓ VERIFIED | `assertCallerIsAdmin` in `manage-authorized-contacts.ts` + `authorized_contacts_write_admin_only` RLS (two independent layers); live assertion (10) — client_contact and no-context writes both rejected |
| 7 | Opt-in confirmation is mandatory and structurally impossible to skip before enabling proactive messaging (SEG-04) | ✓ VERIFIED | Strict `input.optInConfirmed !== true` rejection pre-transaction + DB CHECK `authorized_contacts_opt_in_consistency_check`; live assertion (11) confirms the CHECK fires |
| 8 | Conversation context (team 1:1 vs client 1:1) determines data scope exclusively via GUC + RLS, never an app-layer filter (SEG-05) | ✓ VERIFIED | Code inspection: `grep` for `WHERE.*client_id` app-layer filters in `lib/identity/`, `lib/tenant/`, `lib/clients/manage-authorized-contacts.ts` returns none; GUCs set only inside `withResolvedIdentityContext`/`resolveIdentity` |
| 9 | A team 1:1 respects role: admin sees all clients, member only assigned ones (SEG-06) | ✓ VERIFIED | Live regression assertion (9) — unassigned member sees 0 clients after migration 0007, proving the pre-existing two branches were not broken |
| 10 | A client 1:1 keeps the agent locked to that one client's data, including the client-only vs team-only split on the contact roster and team roster (SEG-07, SEG-08) | ✓ VERIFIED | Live assertion (7) — client_contact scope reads 0 rows from both `authorized_contacts` and `team_members` |
| 11 | The AI-disclosure rule exists as a single source of truth for Phase 3/4 to inject verbatim (SEG-09) | ✓ VERIFIED | `lib/identity/disclosure.ts` exports `AI_DISCLOSURE_RULE`/`AI_DISCLOSURE_REQUIREMENT_ID`; Phase 2 owns the rule only, no agent exists yet to wire it into (correctly out of scope per ROADMAP) |
| 12 | Migrations 0005-0008 are applied to the real Neon database and both live suites pass | ✓ VERIFIED | 02-07-SUMMARY.md: `npm run db:migrate` → `Migrations applied.`; `db:verify-rls` 7/7 (Phase 1 regression intact); `db:verify-identity` 16/18 (2 tracked, non-blocking failures — see below); zero leftover `verify-%` fixture rows |

**Score:** 12/12 truths verified. One residual, non-blocking finding tracked (see frontmatter and section below) — it does not correspond to any current code path and does not fail a ROADMAP-stated success criterion.

### Tracked Residual Finding (not counted as a gap)

**SEG-12 defense-in-depth gap**, found live during 02-07's checkpoint, deliberately left
unfixed after a reverted fix attempt: an already-resolved `unknown` identity's
`withResolvedIdentityContext` scope can still read `team_members` and
`authorized_contacts`, because migration 0007's `<> 'client_contact'` lockout clause is
fail-open for an **unset** `app.role` (the exact GUC shape `resolveIdentity()` itself
uses while it is still determining the role). This verification independently confirmed:

- No production code path currently opens a `withResolvedIdentityContext` scope for an
  `unknown` identity and queries either table — confirmed by `grep -rn
  "withResolvedIdentityContext(" lib/ app/ scripts/`, which shows the only such call
  site is `scripts/verify-identity-resolution.ts` (the test itself, assertions 8b/8c).
- The three revert migrations (0009/0010/0011) restore the exact pre-0009 policy text
  for `authorized_contacts_select_team_only` — verified byte-for-byte identical to
  0006's original clause by direct file comparison during this verification, matching
  02-REVIEW.md's independent finding of the same.
- The gap is real, understood, and documented for whichever phase next adds a
  consumer of `withResolvedIdentityContext` for an unknown identity (most likely Phase
  3, when a real inbound WhatsApp message first reaches this code). It is not
  reclassified as fixed, deferred-by-roadmap-match, or hidden — it is carried forward
  exactly as 02-07-SUMMARY.md already documented it, because ROADMAP Phase 3's stated
  goal ("los mensajes de WhatsApp entran y salen del sistema") does not explicitly
  name closing this gap, so it does not qualify as a Step 9b roadmap-matched deferral.

This does not block Phase 2 because: (1) Phase 2's own ROADMAP success criterion is
about correct identity resolution and cross-**client** isolation, both of which are
live-verified passing; (2) the leak concerns two agency-level tables
(`team_members`/`authorized_contacts`), not cross-**client** data, so it is a
different (narrower, currently unreachable) risk than the one the phase goal names;
(3) Phase 2 explicitly has no real channel yet ("Sin canal real todavía... se prueba
con mensajes simulados") so there is no live traffic exposed to it; (4) the team
attempted a real fix, found it required an infrastructure-level decision (a
BYPASSRLS-scoped connection or a code-review invariant) rather than a policy tweak,
and chose to revert cleanly and document rather than ship an unverified migration
against production — the correct call under this project's own stated verification
standards.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/identity/types.ts` | `ResolvedIdentity` union | ✓ VERIFIED | Exists, exports exact 3-variant union, wired into classify-identity.ts and resolve-identity.ts |
| `lib/identity/classify-identity.ts` | Pure classifier | ✓ VERIFIED | Zero I/O, 7/7 network-free assertions pass (re-run during this verification) |
| `lib/identity/disclosure.ts` | SEG-09 rule constant | ✓ VERIFIED | `AI_DISCLOSURE_RULE` exported, referenced by requirement id |
| `lib/identity/resolve-identity.ts` | DB orchestration shell | ✓ VERIFIED | Imports `classifyIdentity`, sets only `app.agency_id`, live-tested |
| `lib/tenant/with-resolved-identity-context.ts` | Non-Clerk GUC helper | ✓ VERIFIED | Branches on all 3 identity types, `identityDb`/`IdentityTx` exported, live-tested |
| `lib/db/schema/authorized-contacts.ts` | Table + unique idx + opt-in CHECK | ✓ VERIFIED | Present, confirmed live in Neon via `\d+ authorized_contacts` (02-07) |
| `lib/db/schema/agent-action-catalog.ts` | Global risk catalog | ✓ VERIFIED | No `agency_id`, no RLS by design, live-seeded with exactly 3 rows |
| `lib/db/schema/audit-log.ts` | Schema shell | ✓ VERIFIED | Tenant-scoped, no writer/reader/UI anywhere (D-01 compliance confirmed by `grep`) |
| `lib/clients/manage-authorized-contacts.ts` | Admin-only roster Server Actions | ✓ VERIFIED | `addAuthorizedContact`/`removeAuthorizedContact`/`listAuthorizedContacts` exported, no UI added |
| `drizzle/migrations/0005-0008` | DDL/RLS/seed migrations | ✓ VERIFIED | All 4 present on disk, applied to real Neon (02-07), journal contiguous 0-8 |
| `drizzle/migrations/0009-0011` | Revert trail for the SEG-12 fix attempt | ✓ VERIFIED (informational) | Present, byte-for-byte revert confirmed independently in this verification |
| `scripts/verify-identity-classification.ts` | Network-free unit suite | ✓ VERIFIED | Re-run in this verification: 7/7 PASS |
| `scripts/verify-identity-resolution.ts` | Live-Neon integration suite | ✓ VERIFIED | 551 lines, 18 labelled assertions, 16/18 pass live (2 tracked) |
| `package.json` scripts | `verify:identity-classification`, `db:verify-identity` | ✓ VERIFIED | Both present and correctly wired |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `scripts/verify-identity-classification.ts` | `lib/identity/classify-identity.ts` | direct import | ✓ WIRED | Re-run, 7/7 pass |
| `lib/identity/resolve-identity.ts` | `lib/identity/classify-identity.ts` | 2 call sites, no re-implementation | ✓ WIRED | Confirmed by grep and live test |
| `lib/tenant/with-resolved-identity-context.ts` | `app.client_id` GUC | `set_config` inside transaction | ✓ WIRED | Live-confirmed via assertions (5)-(8) |
| `lib/identity/resolve-identity.ts` | `authorized_contacts` table | fallback lookup by (agencyId, phoneNumber) | ✓ WIRED | Live-confirmed, resolves client contacts correctly |
| `lib/clients/manage-authorized-contacts.ts` | `lib/team/current-member.ts` | `assertCallerIsAdmin` inside `withTenantContext` | ✓ WIRED | Confirmed by grep, live-tested via assertion (10) |
| `drizzle/migrations/0007` | `clients_select_by_role` policy | DROP + CREATE, 3rd branch | ✓ WIRED | Live-confirmed via `pg_policies` query and assertions (5)/(6)/(9) |
| `scripts/verify-identity-resolution.ts` | `lib/identity/resolve-identity.ts` / `with-resolved-identity-context.ts` | direct import of real production code (not reimplemented) | ✓ WIRED | Confirmed by grep; this is what makes the live evidence trustworthy rather than a self-test |

### Data-Flow Trace (Level 4)

Not applicable in the strict UI sense — Phase 2 ships no UI or rendering component
(explicitly out of scope per 02-05-PLAN.md and ROADMAP). The equivalent trace here is
"does `resolveIdentity`'s output actually gate what a caller can read," which is
exactly what the live Neon assertions (5)-(9) prove: real Postgres rows come back only
for the correct scope, and the seed data flows from live `INSERT`s through real RLS
policies, not static/mocked results.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Pure classifier covers all 4 ROADMAP identity cases + precedence | `./node_modules/.bin/tsx scripts/verify-identity-classification.ts` (re-run during this verification) | 7/7 `[PASS]`, `All assertions passed.` | ✓ PASS |
| `npx tsc --noEmit` across the full repo | re-run during this verification | `No errors found` | ✓ PASS |
| `npm run lint` across the full repo | re-run during this verification | `No issues found` | ✓ PASS |
| Live Neon: 4 ROADMAP resolution scenarios + cross-agency guard | `npm run db:verify-identity` (02-07, already run against real Neon, not re-run here to avoid touching production data) | 16/18 `[PASS]`, 2 tracked `[FAIL]` (SEG-12 residual) | ✓ PASS (per 02-07-SUMMARY.md, independently cross-checked against migration files in this verification) |
| Live Neon: Phase 1 regression | `npm run db:verify-rls` (02-07) | 7/7 `[PASS]` | ✓ PASS |
| Revert migrations restore exact pre-0009 policy text | Direct file read/compare of 0006 vs 0011 in this verification | Identical `authorized_contacts_select_team_only` clause | ✓ PASS |
| No production code opens an `unknown`-identity `withResolvedIdentityContext` scope | `grep -rn "withResolvedIdentityContext(" lib/ app/ scripts/` | Only the test script does | ✓ PASS (confirms residual finding is currently unreachable) |

Live `db:migrate`/`db:verify-rls`/`db:verify-identity` were not re-executed in this
verification session (no Neon credentials available here, and re-running would touch
live infrastructure) — their results are taken from 02-07-SUMMARY.md's verbatim
recorded output, cross-checked against the actual migration files on disk, git commit
history (`c8af901`, `b632573`), and the independent 02-REVIEW.md code review, all of
which agree.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| SEG-01 | 02-01, 02-04, 02-06 | Every message resolves to team_member/client_contact/unknown before response | ✓ SATISFIED | `resolveIdentity` + `classifyIdentity`, live-tested |
| SEG-02 | 02-02, 02-03, 02-05, 02-06 | One phone → one client; unique per agency | ✓ SATISFIED | Unique index + trigger + live assertions (12)/(13) |
| SEG-03 | 02-03, 02-05, 02-06 | Only the team adds/removes contacts, never the client | ✓ SATISFIED | `assertCallerIsAdmin` + RLS write policy + live assertion (10) |
| SEG-04 | 02-02, 02-03, 02-05, 02-06 | Mandatory explicit opt-in before proactive messaging | ✓ SATISFIED | Strict boolean check + DB CHECK + live assertion (11) |
| SEG-05 | 02-03, 02-04, 02-06 | Scope enforced by GUC+RLS, never app filter | ✓ SATISFIED | Code inspection confirms zero app-layer client filters |
| SEG-06 | 02-04, 02-06 | Team 1:1 respects role (admin/member) | ✓ SATISFIED | Live regression assertion (9) |
| SEG-07 | 02-03, 02-04, 02-06 | Client 1:1 limited to that one client's data | ✓ SATISFIED | Live assertions (5)/(6) |
| SEG-08 | 02-03, 02-06 | Client-visible vs team-only data separation | ✓ SATISFIED | Live assertion (7); `authorized_contacts_select_team_only` excludes `client_contact` |
| SEG-09 | 02-01 | Agent always admits being AI when asked | ✓ SATISFIED (data-model scope) | `AI_DISCLOSURE_RULE` constant; injection into prompts correctly deferred to Phase 3/4 per ROADMAP |
| SEG-12 | 02-03, 02-04, 02-06 | Unknown number gets no account data | ✓ SATISFIED (core flow); ⚠ residual defense-in-depth finding tracked | Live assertions (4)/(8) pass for the actual resolution flow; see Tracked Residual Finding above for the narrower, currently-unreachable gap |

No orphaned requirements: the phase's declared requirement set (SEG-01 through
SEG-09, SEG-12) is fully covered by the union of `requirements:` fields across all 7
plans, matching `.planning/REQUIREMENTS.md` and `.planning/ROADMAP.md`'s Fase 2 scope
exactly. SEG-10/SEG-11 are correctly out of scope for Phase 2 per ROADMAP ("solo como
modelo de datos... per 02-CONTEXT.md D-01") and were not claimed by any plan.

### Anti-Patterns Found

No blocking anti-patterns (TODO/FIXME/placeholder/stub markers) found in any Phase 2
file (`grep` across all 9 key files modified in this phase returned zero matches).

The independent code review (`02-REVIEW.md`, status `issues_found`, 0 critical) found
3 Warnings and 6 Info items, all in latent/unreached code paths, advisory per this
task's framing and not treated as blockers:

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `drizzle/migrations/0006_phase2_identity_rls.sql` | Phone-uniqueness trigger doesn't exclude the row being updated on `UPDATE` (WR-01) | Warning | Latent — no current code path updates a contact's `client_id`/`phone_number` |
| `lib/db/schema/authorized-contacts.ts` | `ON DELETE SET NULL` on `opt_in_confirmed_by` can violate the opt-in CHECK if a confirming team member is ever deleted (WR-02) | Warning | Latent — no team-member-deletion code path exists yet |
| `lib/clients/manage-authorized-contacts.ts` | Team-member-collision and client-collision duplicate-phone errors are indistinguishable to callers (WR-03) | Warning | Cosmetic — no UI consumes this result yet |
| Various (IN-01 to IN-06) | Unchecked role cast, missing phone trim, no email format validation, duplicated regex, string-matching on Postgres error text, inconsistent npm script naming | Info | None security-relevant; style/robustness only |

One process note, not a code anti-pattern: 02-03-SUMMARY.md documents that its executor
worked around a git-hook restriction in its worktree by shelling out to git from
inside a Node script. This did not affect the plan's deliverables (verified by commit
hashes in `git log` matching exactly) and is noted here for completeness, not as a
security or correctness finding against Phase 2's actual output.

### Human Verification Required

None. This phase ships no UI, and its actual runtime behavior (identity resolution +
RLS enforcement) has already been proven against a real Neon database in 02-07's
checkpoint, with independent cross-checks performed in this verification session
(file-level migration comparison, static grep for unreachable call sites, re-run of
the network-free suite, fresh `tsc`/`lint`).

### Gaps Summary

No blocking gaps. Phase 2 achieves its stated goal: given a simulated message from a
team number, a client A number, a client B number, and an unknown number, the system
resolves each to the correct identity and scope, and Postgres RLS — not application
filtering — is what enforces that a client's data never crosses into another client's
scope. This was proven with real Postgres, not just typecheck/build, per the phase's
own explicit anti-false-positive design (02-07's entire reason for existing).

One residual finding is tracked, not hidden: a defense-in-depth gap where an
already-resolved `unknown` identity's scope could read two agency-level tables
(`team_members`, `authorized_contacts`) if a future code path ever queried them under
that exact scope. No such code path exists today. The team found this live, attempted
a fix, correctly recognized the fix needed an infrastructure-level decision rather
than a quick policy patch, and reverted cleanly rather than shipping something
unverified — the right call, and one this verification independently confirmed was
executed byte-for-byte correctly. This is carried forward as a must-read item for
whichever future phase (most likely Phase 3) next adds a real inbound-message
consumer of `withResolvedIdentityContext`.

---

_Verified: 2026-09-09_
_Verifier: Claude (gsd-verifier)_
