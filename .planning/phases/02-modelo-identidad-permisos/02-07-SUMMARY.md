---
phase: 02-modelo-identidad-permisos
plan: 07
subsystem: identity-model-live-verification
tags: [neon-migration, rls, checkpoint, real-bug-found]
requires:
  - drizzle/migrations/0005-0008 (Phase 2 schema, RLS, catalog seed — 02-01..02-06)
  - .planning/phases/02-modelo-identidad-permisos/02-VALIDATION.md
provides:
  - Migrations 0005-0008 applied to the real Neon database (project
    indusvit-erp-dev, branch main)
  - Live-Neon proof that scripts/db:verify-rls (Phase 1 regression) and
    scripts/db:verify-identity (Phase 2 identity/RLS integration) both run
    against real Postgres, not just typecheck
  - A real, confirmed RLS gap (SEG-12: unknown identity's post-resolution
    scope can still read team_members and authorized_contacts), left open
    and documented rather than papered over with an unverified fix
affects:
  - "Any future plan touching identity resolution or RLS on team_members /
    authorized_contacts must account for the open SEG-12 gap below before
    treating those tables as fully locked down for unknown callers"
tech-stack:
  added: []
  patterns:
    - "A migration written to close a leak must be tested against every
      code path that legitimately shares the leaked context's exact GUC
      shape, not just the one test asserting the leak — this phase's own
      resolveIdentity() function turned out to be one of those paths"
---

## What was done

Task 1 (offline pre-flight, run by the orchestrator, sandbox-safe): journal
integrity confirmed (9 contiguous entries, 0000..0008), all migration files
present, `npx drizzle-kit generate` reported zero schema drift, `tsc`/`lint`/
`verify:identity-classification` all green.

Task 2 (the `[BLOCKING]` human-action checkpoint) was run with real Neon
access, obtained via the user directing the agent to pull the `neondb_owner`
connection string from the Neon Console (project `indusvit-erp-dev`) through
a browser session, since the sandbox's own `.env` only holds the non-DDL
`app_user` role.

1. Confirmed `current_user = neondb_owner`.
2. `npm run db:migrate` → `Migrations applied.` — 0005 through 0008 landed.
3. Confirmed via `psql`: 4 new migration rows in `drizzle.__drizzle_migrations`,
   `authorized_contacts` table structure matches the plan (FK/CHECK/unique
   index/RLS/trigger all present), `agent_action_catalog` has exactly the
   three D-02 rows (`new_client_content`/high, `payment_reminder`/low,
   `reschedule_appointment`/high).
4. Confirmed via `pg_policies`: all expected policy names present
   (`authorized_contacts_select_team_only`, `authorized_contacts_write_admin_only`,
   `audit_log_tenant_isolation`, `clients_select_by_role`,
   `clients_write_admin_only`, plus the four `*_tenant_isolation` policies),
   `agent_action_catalog` appears zero times (correctly has no RLS).
5. Switched to `app_user` and ran `npm run db:verify-rls` — **all 7
   assertions passed** (Phase 1 regression, migration 0007's added clauses
   did not break existing access).
6. Ran `npm run db:verify-identity` — **16 of 18 assertions passed**. Two
   real failures found (see Deviations below): `(8b)` and `(8c)`, both under
   SEG-12.
7. Confirmed cleanup: `select count(*) from agencies where id like
   'verify-%'` → `0`, both before and after the fix attempt described below.

## Deviations from Plan

### Real bug found, fix attempted, fix caused regressions, fully reverted — gap documented open

**[Rule 1 — Bug, but NOT fixed in this plan; see rationale below] SEG-12: an
already-resolved `unknown` identity's `withResolvedIdentityContext` scope can
still read `team_members` and `authorized_contacts`**

- **Found during:** Task 2, `npm run db:verify-identity` against real Neon.
- **Issue:** `0007_client_contact_scope.sql`'s lockout clause
  (`coalesce(current_setting('app.role', true), '') <> 'client_contact'`) is
  fail-open for a caller with `app.role` **unset** (not just non-`client_contact`).
  `coalesce(NULL, '') = ''`, and `'' <> 'client_contact'` is true, so the
  clause — written to block `client_contact` specifically — never considered
  the `unknown` case, where `withResolvedIdentityContext` deliberately sets
  only `app.agency_id` and nothing else (per 02-04's own must-have). Live
  assertions `(8b)`/`(8c)` proved it: an unknown-resolved scope read 1 row
  from `team_members` and 2 rows from `authorized_contacts` that it should
  never see.
- **First fix attempt (migration `0009_unknown_identity_lockout_fix.sql`):**
  tightened `team_members_tenant_isolation`, `client_assignments_tenant_isolation`,
  `agent_brand_config_tenant_isolation`, `agencies_tenant_isolation` and
  `authorized_contacts_select_team_only` to require `app.role IN ('admin',
  'member')` instead of merely `<> 'client_contact'`.
- **Regression #1:** `npm run db:verify-rls`'s own seeding crashed —
  `lib/agencies/create-agency.ts` (the `organization.created` webhook)
  inserts the `agencies` row itself with only `app.agency_id` set, before any
  `team_members` row (and therefore any role) exists. The stricter `WITH
  CHECK` rejected that insert outright. `lib/team/sync-membership.ts` (the
  `organizationMembership.created` webhook) has the same shape: it `SELECT`s
  `team_members` by email with only `app.agency_id` set, to decide whether an
  invited row already exists — the stricter `USING` clause would have made
  every real member-acceptance event silently misroute.
- **Attempted narrower fix (migration `0010`, first draft, discarded before
  applying):** split `USING` (read) from `WITH CHECK` (write) — keep the
  write side permissive (matching 0007), tighten only the read side. This
  fixes the `agencies`/`client_assignments`/`agent_brand_config` write paths,
  but does not fix `team_members`, because `sync-membership.ts`'s check is
  itself a **read** with no role set.
- **Regression #2 (the actual blocker):** re-running `npm run
  db:verify-identity` after the (still too broad) `authorized_contacts`
  tightening showed assertions `(2)`, `(3)`, `(3b)` — previously passing —
  now failing: every real contact phone number resolved as `unknown` instead
  of `client_contact`. Root cause: `lib/identity/resolve-identity.ts`'s
  `resolveIdentity()` — the identity-resolution function itself, not a
  post-resolution scope — reads `authorized_contacts` by `(agencyId,
  phoneNumber)` with **only `app.agency_id` set**, precisely because
  determining whether a number belongs to a client contact is what
  establishes the role in the first place. At the RLS/GUC layer, this
  legitimate resolution-time read and the "should be blocked"
  already-resolved-`unknown`-scope read from assertions `(8b)/(8c)` are
  byte-for-byte indistinguishable session states (`app.agency_id` set,
  `app.role` unset). Postgres RLS, keyed only on `app.agency_id`/`app.role`,
  cannot enforce "this exact read is fine during resolution, but not after."
- **Resolution: fully reverted.** Migrations `0010_revert_bootstrap_regression.sql`
  and `0011_revert_authorized_contacts_regression.sql` restore all five
  policies to their exact pre-`0009` (`0006`/`0007`) clauses. Re-ran all
  three suites after the full revert: `verify:identity-classification` (7/7),
  `db:verify-rls` (7/7), `db:verify-identity` (16/18 — identical result to
  the very first run, confirming the revert is exact and introduced no new
  regressions anywhere else). Zero leftover `verify-%` rows confirmed both
  after the failed attempt and after the final revert.
- **Why not fixed for real in this plan:** a real fix needs a mechanism RLS
  can use to tell "resolution in progress" apart from "already resolved as
  unknown" that is NOT just another spoofable session GUC (an app-settable
  flag is not a security boundary — nothing stops any other code path from
  setting it too). The two real options are (a) run `resolveIdentity()`'s
  lookup over a narrowly-scoped, `BYPASSRLS`-capable connection/role
  distinct from `app_user`, used for nothing else, or (b) accept this as an
  application-level invariant (no legitimate code path other than
  `resolveIdentity()` itself should ever query these two tables with
  `app.role` unset) enforced by code review / a lint rule rather than by
  RLS alone. Both are infrastructure/design decisions for a dedicated
  follow-up plan, not a migration to guess at against a live production
  database inside a checkpoint. Files touched in the discarded attempt were
  fully reverted; `0009`, `0010`, `0011` remain in migration history as an
  honest record of what was tried and why it didn't work, per net effect
  they cancel out to the pre-`0009` state.
- **Files:** `drizzle/migrations/0009_unknown_identity_lockout_fix.sql`,
  `drizzle/migrations/0010_revert_bootstrap_regression.sql`,
  `drizzle/migrations/0011_revert_authorized_contacts_regression.sql`,
  `drizzle/migrations/meta/_journal.json`
- **Residual risk accepted:** an `unknown`-resolved WhatsApp sender, if
  application code ever opened a `withResolvedIdentityContext` scope for it
  and queried `team_members`/`authorized_contacts` directly (no current code
  path does this — Phase 2 has no such call site), could read the agency's
  team roster and contact roster. Tracked as an open finding for whichever
  future phase next touches identity resolution or adds a new
  `withResolvedIdentityContext` call site.

## Authentication / Environment Gates

Same category of gate Phase 1 hit, resolved the same way (user-directed,
this time via browser instead of `.env.local`):

1. **Sandbox has no owner-role credentials.** `.env` only holds the
   non-DDL `app_user` connection string (by design — `app_user` has no
   grants for `CREATE TABLE`/`CREATE POLICY`, per `0001_rls_policies.sql`).
   No owner-role string exists anywhere in the repo or its env files.
2. **Resolved via direct user instruction:** the user directed the agent to
   open the Neon Console in the browser, navigate to the project's Connect
   dialog, and read the `neondb_owner` connection string directly — a
   one-time, explicitly authorized action, not something pulled from any
   file. Every subsequent DDL-touching command (`npm run db:migrate`, each
   time) required a fresh explicit user confirmation before running, per
   this session's own auto-mode classifier treating live-database DDL as a
   risk category requiring confirmation regardless of prior approvals in
   the same session.
3. **Unlike Phase 1, this session DID have live network egress to Neon** —
   `psql`/`db:migrate`/`db:verify-rls`/`db:verify-identity` all ran directly
   from this sandboxed session once the owner credential was available. The
   "no network egress" note in STATE.md's Phase 1 history did not hold for
   this session; do not assume it holds for future sessions either — check
   directly (`psql "$DATABASE_URL" -c "select 1"`) rather than assuming the
   gate still applies.

## Note on this plan's own acceptance criteria

Task 3's acceptance criteria state `git status --porcelain lib/ drizzle/
scripts/` should be empty ("this plan changes no source"). That does not
hold here: `drizzle/migrations/0009-0011` and `meta/_journal.json` were
added while investigating and then fully reverting the SEG-12 finding above.
This mirrors Phase 1's own precedent (`01-fundaciones-cuenta-equipo-01-SUMMARY.md`,
deviations 4-5): a live-Neon checkpoint that finds a real bug is expected to
touch migration files, not just report and stop. The net database state
after `0009`+`0010`+`0011` is byte-for-byte identical to before `0009` — no
schema or policy actually changed — but the file-level diff is not empty.

## Next Phase Readiness

- Phase 2's identity model, schema, RLS, and Server Actions are live-verified
  against real Neon: 16/18 identity-resolution assertions pass, 7/7 Phase 1
  regression assertions pass, zero schema drift, zero leftover test data.
- The two failing assertions (`8b`/`8c`) are a real, understood, deliberately
  unfixed gap — not a false negative and not something blocking Phase 2's
  actual delivered scope (no current code path exercises it). Any phase that
  adds a new consumer of `withResolvedIdentityContext` for an `unknown`
  identity, or revisits `resolveIdentity()`'s internals, must re-read this
  SUMMARY first.
- The three-branch RLS convention (admin / assigned-member / client_contact)
  from `0007_client_contact_scope.sql` and the `NULLIF(current_setting(...),
  '')::uuid` rule for every new uuid-typed GUC (from `0002` and reused in
  `0007`) are the two conventions every future client-scoped table must
  repeat — see `.planning/STATE.md`.
