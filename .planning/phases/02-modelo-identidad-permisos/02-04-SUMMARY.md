---
phase: 02-modelo-identidad-permisos
plan: 04
subsystem: auth
tags: [drizzle, postgres, rls, neon-serverless, identity]

# Dependency graph
requires:
  - phase: 02-01
    provides: "classifyIdentity pure classifier and ResolvedIdentity/TeamMemberIdentityRow/AuthorizedContactIdentityRow types (lib/identity/)"
  - phase: 02-02
    provides: "authorizedContacts Drizzle schema with (agencyId, phoneNumber) uniqueness"
  - phase: 01-01
    provides: "withTenantContext pattern (transaction-local set_config GUCs) this plan mirrors for non-Clerk callers"
provides:
  - "resolveIdentity(agencyId, phoneNumber) — network shell that fetches team_members/authorized_contacts rows and delegates the decision to classifyIdentity"
  - "withResolvedIdentityContext(agencyId, identity, fn) — non-Clerk GUC-setting transaction helper, the WhatsApp-sender parallel to withTenantContext"
  - "identityDb / IdentityTx exports, shared connection pool for both modules and the tsx verification scripts"
affects: [02-05, 02-06, 02-07, phase-03-whatsapp-webhook]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-Clerk GUC-setting transaction helper as a sibling to withTenantContext, sharing the exact same GUC contract (app.agency_id/team_member_id/role/client_id) so RLS policies never need to know which helper set them"
    - "Resolution (resolveIdentity) and authorization (withResolvedIdentityContext) kept in two separate functions/files so a lookup can never accidentally become an authorization"

key-files:
  created:
    - lib/tenant/with-resolved-identity-context.ts
    - lib/identity/resolve-identity.ts
  modified: []

key-decisions:
  - "Neither new module imports `server-only` — both are imported by scripts/verify-identity-resolution.ts (introduced in a later plan) under plain tsx, where the server-only package's throwing entrypoint would crash the script; documented in both file headers so nobody re-adds it"
  - "resolveIdentity sets only app.agency_id (verified: exactly one set_config call in the file) — setting the identity's own GUCs is exclusively withResolvedIdentityContext's job"
  - "unknown identities set no GUC beyond app.agency_id, relying on RLS's fail-closed default (0001_rls_policies.sql) for SEG-12, rather than adding a guest/public branch"

patterns-established:
  - "GUC contract shared verbatim between withTenantContext (Clerk-authenticated) and withResolvedIdentityContext (WhatsApp-sender-authenticated): app.agency_id always, app.team_member_id/app.role for team members, app.role='client_contact'+app.client_id for client contacts, nothing beyond app.agency_id for unknown"

requirements-completed: [SEG-01, SEG-05, SEG-06, SEG-07, SEG-12]

# Metrics
duration: 6min
completed: 2026-09-08
---

# Phase 2 Plan 04: Identity Resolution + GUC Context Summary

**resolveIdentity(agencyId, phoneNumber) two-table lookup shell delegating to the pure classifier, plus withResolvedIdentityContext, the non-Clerk twin of withTenantContext that sets app.client_id and friends inside a transaction-local set_config.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-09-08T16:13:49-05:00 (base commit)
- **Completed:** 2026-09-08T16:18:40-05:00
- **Tasks:** 2
- **Files modified:** 2 (both created)

## Accomplishments
- `lib/tenant/with-resolved-identity-context.ts` — GUC-setting transaction helper for WhatsApp-sender identities (no Clerk session), branching on `ResolvedIdentity.type` to set exactly the documented GUCs per identity, with the `unknown` branch deliberately setting nothing beyond `app.agency_id`
- `lib/identity/resolve-identity.ts` — two-table lookup (`team_members.whatsapp_number` first per D-06, then `authorized_contacts.phone_number`), delegating the actual decision to plan 02-01's `classifyIdentity` with zero inline re-implementation
- Both modules avoid `import "server-only"` on purpose (documented in-file) so they remain importable from plain `tsx` verification scripts
- No application-layer `client_id` filter anywhere in either file — RLS + the GUCs are the only enforcement (SEG-05)

## Task Commits

Each task was committed atomically:

1. **Task 1: withResolvedIdentityContext — the non-Clerk GUC-setting transaction** - `1eaeb3a` (feat)
2. **Task 2: resolveIdentity — the two-table lookup shell** - `2b374fb` (feat)

**Plan metadata:** committed alongside this SUMMARY (see final commit)

## Files Created/Modified
- `lib/tenant/with-resolved-identity-context.ts` - Non-Clerk GUC-setting transaction helper (`withResolvedIdentityContext`), plus the shared `identityDb` Drizzle instance and `IdentityTx` type used by both this file and `resolveIdentity`
- `lib/identity/resolve-identity.ts` - `resolveIdentity(agencyId, phoneNumber)`: sets `app.agency_id`, looks up team member then authorized contact, returns `classifyIdentity`'s result

## Decisions Made
- Followed the plan's verbatim file content exactly as specified in the `<action>` blocks — no design decisions of my own were required. The two decisions worth restating (also captured in `key-decisions` above): (1) omit `server-only` deliberately, documented in-file; (2) keep resolution and GUC-setting in two disjoint functions.

## Deviations from Plan

### Documented — not fixed (plan's own acceptance criteria vs. its own verbatim content)

Two of Task 1's acceptance-criteria greps have exact-count expectations that
contradict the literal doc-comment text the same plan instructs verbatim in
its `<action>` block (the doc comment mirrors `with-tenant-context.ts`'s
established documentation standard, which explains *why* `neon-http` and
`server-only` are NOT used by naming them in prose):

- `grep -c 'neon-http' lib/tenant/with-resolved-identity-context.ts` is
  expected to return `0`, but the required doc comment includes the phrase
  "never `drizzle-orm/neon-http`" — one matching line, so the actual count is
  `1`. The substantive requirement — no actual `import ... from
  "drizzle-orm/neon-http"` statement — is satisfied and separately verified
  by `grep -q 'drizzle-orm/neon-serverless'` passing and there being no
  neon-http import line.
- `grep -c 'server-only' lib/tenant/with-resolved-identity-context.ts` is
  expected to return `1`, but the required doc comment mentions the string
  `server-only` on three separate lines (explaining why it's deliberately
  omitted). The substantive requirement — zero actual `import "server-only"`
  statements — is satisfied and separately verified by
  `grep -c '^import "server-only"'` returning `0`, exactly as required.

No code was changed to force these two counts to match, because doing so
would mean stripping the mandated explanatory prose from the header comment
(which the plan's own `<action>` text requires verbatim, and which mirrors
`with-tenant-context.ts`'s existing documented pattern of naming the
never-used alternative). This is flagged here rather than silently ignored;
it does not affect correctness, security, or SEG-01/05/06/07/12 compliance —
all criteria that test actual code behavior (no `server-only` import, no
`auth()` call, exactly one `set_config` in `resolveIdentity`, `neon-
serverless` present, GUCs set per branch) pass exactly as specified.

**Total deviations:** 0 auto-fixed, 2 documented-only (plan self-contradiction in acceptance-criteria exact-counts, not a code defect)
**Impact on plan:** None on functionality or security. No scope creep.

## Issues Encountered
None beyond the documented acceptance-criteria discrepancy above.

## User Setup Required
None - no external service configuration required.

## Live-Database Verification Not Performed

Per the plan's own `<verification>` section (item 5) and this project's
`STATE.md` note that sandboxed sessions have no Neon egress: the actual
runtime behavior of `resolveIdentity` and `withResolvedIdentityContext`
against a real Postgres connection (real `set_config`, real RLS policy
evaluation for `app.client_id`) was NOT exercised here. What WAS verified
in this sandbox:
- `npx tsc --noEmit` — 0 errors
- `npm run lint` — 0 issues
- `npm run verify:identity-classification` — 7/7 assertions pass (plan
  02-01's pure-classifier suite, unaffected/not regressed)
- All of both tasks' acceptance-criteria greps (see Deviations section for
  the two documented false-positive counts)
- Code inspection confirms the two-step `set_config` → lookup shape mirrors
  `with-tenant-context.ts` lines 74-92 exactly, and that `app.client_id` is
  set only in the `client_contact` branch

Full integration proof against real Neon (does `withResolvedIdentityContext`
actually restrict a client_contact's session to their one client via the RLS
policy from plan 02-03's migration 0007) is deferred to plan 02-06 (test
suite) and 02-07 (checkpoint), as the plan explicitly anticipates.

## Next Phase Readiness
- `resolveIdentity` and `withResolvedIdentityContext` are both importable
  and type-check cleanly; 02-05/02-06/02-07 can build on them
- No blockers introduced by this plan. The pre-existing sandbox network gate
  (no Neon egress) carries forward unchanged into 02-06/02-07 as already
  noted in STATE.md

---
*Phase: 02-modelo-identidad-permisos*
*Completed: 2026-09-08*

## Self-Check: PASSED

- FOUND: lib/tenant/with-resolved-identity-context.ts
- FOUND: lib/identity/resolve-identity.ts
- FOUND commit: 1eaeb3a
- FOUND commit: 2b374fb
