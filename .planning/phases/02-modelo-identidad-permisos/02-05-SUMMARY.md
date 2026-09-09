---
phase: 02-modelo-identidad-permisos
plan: 05
subsystem: api
tags: [drizzle, postgres, rls, server-actions, clerk, nextjs]

# Dependency graph
requires:
  - phase: 02-modelo-identidad-permisos
    provides: "authorized_contacts table (02-02) and its RLS policies + phone-collision triggers (02-03)"
provides:
  - "addAuthorizedContact, removeAuthorizedContact, listAuthorizedContacts Server Actions — the only legitimate write/read path to the authorized_contacts roster"
affects: [02-06, 02-07, phase-3-whatsapp-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Validate untrusted input before opening any DB transaction, return typed { ok, error } results instead of throwing for expected failures (matches lib/team/invite-member.ts, lib/clients/assign-client.ts)"
    - "Never accept caller-supplied trust-boundary fields (agencyId, attester id, timestamps) — always derive server-side from auth() / assertCallerIsAdmin()"
    - "Let a DB-layer unique index/trigger be the real enforcement for race-prone uniqueness checks; catch the resulting error and do a best-effort follow-up read only for a human-readable message"

key-files:
  created: [lib/clients/manage-authorized-contacts.ts]
  modified: []

key-decisions:
  - "TDD gate (RED/GREEN commits) was not applied to Task 1 despite tdd=\"true\" in the plan frontmatter: the task's own <verify>/<acceptance_criteria> only require tsc/lint/grep checks (no test file), and genuine RED/GREEN would require a live Neon connection to exercise the transaction, unique index, and cross-table trigger — unavailable in this sandboxed session per the plan's own no_live_db_note. Documented under TDD Gate Compliance below rather than fabricating a passing test."
  - "Task 2's acceptance criterion 'grep -c assertCallerIsAdmin returns 2' cannot be satisfied literally because the file also imports the identifier (contributing a 3rd match line) — verified intent instead via grep -c 'assertCallerIsAdmin(tx, userId)' (the actual call sites) returning 2, and confirmed listAuthorizedContacts contains zero calls to it."

requirements-completed: [SEG-02, SEG-03, SEG-04]

# Metrics
duration: 25min
completed: 2026-09-09
---

# Phase 2 Plan 05: Authorized Contact Roster Server Actions Summary

**Admin-gated `addAuthorizedContact`/`removeAuthorizedContact` plus agency-wide `listAuthorizedContacts` in `lib/clients/manage-authorized-contacts.ts`, with opt-in confirmation, attester, and agency all derived server-side — no UI.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-09-09T13:18:31Z
- **Tasks:** 2
- **Files modified:** 1 (created)

## Accomplishments
- `addAuthorizedContact` validates name/phone/opt-in before any transaction opens, requires an admin caller, and derives `agencyId`, `optInConfirmedBy`, and `optInConfirmedAt` entirely server-side — never from input
- Duplicate-phone collisions (same agency, or colliding with a team member's WhatsApp number) are caught from the DB-layer unique index / migration 0006 trigger and translated into a typed `phone_already_linked` result naming the owning client, with no pre-check race
- `removeAuthorizedContact` mirrors `unassignClient`'s admin-only shape exactly, with no redundant `agencyId` predicate (RLS already scopes it)
- `listAuthorizedContacts` is deliberately agency-wide and NOT admin-gated (D-09), relying entirely on `authorized_contacts_select_team_only` RLS (which already excludes `client_contact` role reads per SEG-08) — no `.where()` in application code
- No UI, page, or route added — confirmed via `grep -rn 'authorizedContacts' app/` returning nothing

## Task Commits

Each task was committed atomically:

1. **Task 1: addAuthorizedContact — admin-gated, opt-in-enforcing insert** - `321af39` (feat)
2. **Task 2: removeAuthorizedContact and listAuthorizedContacts** - `ff6393e` (feat)

**Plan metadata:** (this commit, docs)

_Note: Task 1 carried `tdd="true"` in the plan frontmatter but no RED/GREEN test commits were produced — see "TDD Gate Compliance" below._

## Files Created/Modified
- `lib/clients/manage-authorized-contacts.ts` - `addAuthorizedContact`, `removeAuthorizedContact`, `listAuthorizedContacts` Server Actions; the only write/read path to the `authorized_contacts` table at the application layer

## Decisions Made
- Reused `lib/team/invite-member.ts`'s `WHATSAPP_RE` verbatim rather than introducing a phone-parsing library, per the plan's explicit instruction and the codebase's existing precedent (already duplicated once for `team_members.whatsappNumber`)
- Imported `AdminActionResult` from `lib/clients/assign-client.ts` instead of redeclaring it, keeping one canonical `{ ok: true } | { ok: false; error: "not_admin" }` shape across both files
- The duplicate-phone follow-up lookup runs in a fresh `withTenantContext` call after the failed insert's transaction has already rolled back, as the plan specifies — it is best-effort only for message quality; the block itself already happened at the database layer

## Deviations from Plan

None requiring a rule-based fix. Two verification-only notes:

### TDD Gate Compliance

Task 1 was marked `tdd="true"` in the plan frontmatter, but its own `<verify>` section specifies only `npx tsc --noEmit` and its `<acceptance_criteria>` are all static grep/tsc/lint checks — no test file is described in `<action>`. A genuine RED/GREEN cycle for this task would need to exercise a live transaction, the `authorized_contacts_agency_id_phone_number_idx` unique index, and migration 0006's cross-table trigger — none of which are exercisable without a live Neon connection, which this sandboxed session does not have (consistent with the plan's own `<verification>` point 5: "Runtime behavior against real Neon/Clerk is NOT verified here... covered by plan 02-07's gate"). No `test(...)` commit was created. This mirrors the codebase's existing practice of deferring DB-dependent proof to `scripts/verify-*.ts` run against real infrastructure, rather than mocking `withTenantContext`. Full integration proof (including the RED/GREEN behavior this task's `<behavior>` section describes) is deferred to plan 02-07 as the plan itself anticipates.

### Acceptance criterion imprecision (non-blocking)

Task 2's acceptance criteria state `grep -c 'assertCallerIsAdmin' lib/clients/manage-authorized-contacts.ts` should return 2. The file necessarily also has one `import { ..., assertCallerIsAdmin } from ...` line, so a plain-identifier `grep -c` returns 3, not 2 (grep counts matching lines, and the import line is a distinct line from either call site). Verified the actual substantive requirement instead: `grep -c 'assertCallerIsAdmin(tx, userId)'` (the call sites) returns exactly 2, and `listAuthorizedContacts`'s body contains zero calls to it — matching D-09's intent that only `add`/`remove` are admin-gated.

---

**Total deviations:** 0 auto-fixed. Two verification notes documented above (TDD gate scope, one acceptance-criterion literal-count caveat); neither reflects a functional gap.
**Impact on plan:** No scope creep. All behavioral, security, and structural requirements from the plan's `<behavior>`, `<action>`, and `<threat_model>` sections are implemented and verified via `tsc`, `lint`, `verify:identity-classification`, and targeted greps.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `lib/clients/manage-authorized-contacts.ts` is ready to be composed by 02-06 (identity resolver) and exercised end-to-end by 02-07's live-Neon verification gate, which is where this plan's `<behavior>` assertions (opt-in rejection, duplicate-phone detection, admin gating) get their first live-DB proof.
- No blockers. Runtime/live-DB verification remains explicitly deferred to 02-07 per this plan's own scope.

---
*Phase: 02-modelo-identidad-permisos*
*Completed: 2026-09-09*

## Self-Check: PASSED

- FOUND: lib/clients/manage-authorized-contacts.ts
- FOUND: .planning/phases/02-modelo-identidad-permisos/02-05-SUMMARY.md
- FOUND commit: 321af39
- FOUND commit: ff6393e
