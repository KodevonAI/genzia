---
phase: 02-modelo-identidad-permisos
plan: 02
subsystem: database
tags: [drizzle, postgres, migrations, multi-tenant, whatsapp-opt-in, audit-log]

# Dependency graph
requires:
  - phase: 01-fundaciones-cuenta-equipo
    provides: "agencies, team_members, clients, client_assignments Drizzle tables + RLS pattern (uniqueIndex/check idioms, tenant-scoped FK cascade shape)"
provides:
  - "authorized_contacts Drizzle table (D-05/D-08, SEG-02/SEG-04) with agency+phone uniqueness and opt-in attestation CHECK"
  - "agent_action_catalog Drizzle table — global static risk catalog shell (D-01/D-02)"
  - "audit_log Drizzle table — tenant-scoped append-only schema shell (D-01)"
  - "drizzle/migrations/0005_phase2_identity_tables.sql — generated DDL for all three tables, not yet applied to Neon"
affects: [02-03-rls-permissions, 02-04-identity-resolver, 02-05-roster-server-action, 02-06-integration-suite, 02-07-apply-migrations, phase-04-agent-autonomy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Third-party PII table (authorized_contacts) follows the same tenant-scoped pgTable + cascade-FK + uniqueIndex + check() idiom as Phase 1 tables (team-members.ts, client-assignments.ts)"
    - "Data-model-only schema shells (agent_action_catalog, audit_log) with zero application logic — engine/queue/UI explicitly deferred to a later phase, enforced by task instructions forbidding new files outside the three schema files"
    - "Offline DDL generation via `drizzle-kit generate --name <deterministic-name>` — no live DB connection needed; migration applied later in a separate, explicitly gated plan"

key-files:
  created:
    - lib/db/schema/authorized-contacts.ts
    - lib/db/schema/agent-action-catalog.ts
    - lib/db/schema/audit-log.ts
    - drizzle/migrations/0005_phase2_identity_tables.sql
    - drizzle/migrations/meta/0005_snapshot.json
  modified:
    - lib/db/schema/index.ts
    - drizzle/migrations/meta/_journal.json

key-decisions:
  - "opt_in_confirmed_by_team is a distinct boolean from a hypothetical Meta-verified opt-in flag — it is the team's own manual attestation, enforced consistent-or-null via a DB CHECK constraint tying it to opt_in_confirmed_by + opt_in_confirmed_at"
  - "agent_action_catalog has no agency_id and no RLS — it is Genzia's own global classification data, not tenant data"
  - "audit_log is schema-only in this phase: no writer, no reader, no UI anywhere in the repo, per D-01"
  - "Migration 0005 generated but NOT applied to Neon — db:migrate is explicitly deferred to plan 02-07's blocking task, after RLS/GRANT migrations exist in plan 02-03, to avoid a window where new tables exist with no RLS policy"

patterns-established:
  - "Reworded a doc comment when its literal prose text collided with its own grep-based acceptance check, rather than deviating from the underlying architectural intent"

requirements-completed: [SEG-02, SEG-04]

# Metrics
duration: ~15min
completed: 2026-09-08
---

# Phase 2 Plan 02: Identity & Risk Data Model Summary

**Three new Drizzle tables (authorized_contacts, agent_action_catalog, audit_log) plus a numbered offline migration (0005), with no engine/queue/UI code and nothing yet applied to Neon.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-09-08 (session start)
- **Completed:** 2026-09-08T21:10:04Z
- **Tasks:** 3/3 completed
- **Files modified:** 7 (3 created schema files, 1 modified barrel, 3 migration artifacts)

## Accomplishments
- `authorized_contacts` table with third-party PII columns (name, phone, email, contact role), cascade FKs to `agencies`/`clients`/`team_members`, a unique `(agency_id, phone_number)` index, and a CHECK constraint making it impossible to set `opt_in_confirmed_by_team = true` without both a confirming team member and a timestamp
- `agent_action_catalog` — a global, non-tenant-scoped static risk catalog shell restricted to `risk_level in ('low', 'high')` at the DB layer
- `audit_log` — a tenant-scoped, append-only schema shell (nullable `client_id`, FK to the catalog, snapshot `risk_level` column) with zero business logic anywhere in the repo
- Barrel (`lib/db/schema/index.ts`) extended with all three new exports
- Migration `0005_phase2_identity_tables.sql` generated offline via `drizzle-kit generate`, containing exactly the 3 expected `CREATE TABLE` statements, the unique index, all three CHECK constraints, and FK constraints to `agencies`, `clients`, `team_members`, `agent_action_catalog` — verified against the plan's exact acceptance checklist
- Nothing applied to Neon — `db:migrate` was not run, per the plan's explicit deferral to plan 02-07

## Task Commits

Each task was committed atomically:

1. **Task 1: Create the authorized_contacts Drizzle table** - `cefa425` (feat)
2. **Task 2: Create agent_action_catalog and audit_log shells, extend the barrel** - `78ba015` (feat)
3. **Task 3: Generate the numbered DDL migration offline** - `181c66c` (feat)

_Note: no `docs: complete plan` metadata commit — this is a parallel worktree execution; STATE.md/ROADMAP.md updates and the final metadata commit are owned by the orchestrator after all wave agents complete._

## Files Created/Modified
- `lib/db/schema/authorized-contacts.ts` - Third-party contact table (D-05/D-08); unique agency+phone index; opt-in consistency CHECK
- `lib/db/schema/agent-action-catalog.ts` - Global static action-risk catalog shell (D-01/D-02); risk_level CHECK
- `lib/db/schema/audit-log.ts` - Tenant-scoped append-only audit log shell (D-01); FK to catalog; snapshot risk_level
- `lib/db/schema/index.ts` - Barrel extended with 3 new table exports (8 lines total)
- `drizzle/migrations/0005_phase2_identity_tables.sql` - Generated DDL for all three new tables
- `drizzle/migrations/meta/0005_snapshot.json` - Drizzle-kit schema snapshot for migration 0005
- `drizzle/migrations/meta/_journal.json` - New `idx: 5` entry, tag `0005_phase2_identity_tables`

## Decisions Made
- Followed the plan's exact table definitions verbatim (Tasks 1 and 2 provided complete file content in the plan)
- Used `--name phase2_identity_tables` on `drizzle-kit generate` for a deterministic migration tag instead of a random codename, per plan instruction
- Did not run `db:migrate` or `drizzle-kit push` — both explicitly forbidden in this plan to avoid a window of unprotected (no-RLS, no-GRANT) tables in Neon

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reworded a self-contradictory doc comment in agent-action-catalog.ts**
- **Found during:** Task 2 (agent_action_catalog shell)
- **Issue:** The plan's own provided file content for `lib/db/schema/agent-action-catalog.ts` includes prose text "Deliberately has NO `agency_id` column..." — but the plan's own acceptance criteria for that same task requires `grep -c 'agency_id' lib/db/schema/agent-action-catalog.ts` to return 0. Written verbatim, the file would fail its own acceptance check.
- **Fix:** Reworded the sentence to "Deliberately has no per-agency foreign key and no row-level security" — same meaning, same architectural point (global, non-tenant-scoped catalog), without the literal string `agency_id`.
- **Files modified:** `lib/db/schema/agent-action-catalog.ts`
- **Verification:** `grep -c 'agency_id' lib/db/schema/agent-action-catalog.ts` returns 0; `npx tsc --noEmit` exits 0
- **Committed in:** `78ba015` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug/acceptance-check fix)
**Impact on plan:** Cosmetic — a doc comment wording change only, no change to table shape, constraints, or architectural intent. No scope creep.

## Issues Encountered
- `npm run verify:identity-classification` (referenced in the plan's overall `<verification>` section as "plan 02-01's suite must not regress") does not exist yet in this worktree — plan 02-01 is a sibling plan executing concurrently in a separate git worktree with no file overlap by design, and adds that script there. This is expected under the parallel wave-1 execution model (02-01 and 02-02 have no `depends_on` on each other) and is not a regression introduced by this plan; the two worktrees are merged by the orchestrator after both complete.

## User Setup Required

None - no external service configuration required. Migration 0005 is generated on disk but intentionally not applied to Neon; applying it happens in plan 02-07 alongside plan 02-03's RLS/GRANT migrations.

## Next Phase Readiness
- Plan 02-03 (RLS policies) can now write policies against `authorized_contacts`, `agent_action_catalog`, and `audit_log` since the Drizzle definitions and generated DDL exist
- Plan 02-04 (identity resolver) and 02-05 (roster Server Action) can import `authorizedContacts` from the schema barrel
- Migration 0005 is on disk and ready to be applied together with 02-03's RLS migrations in plan 02-07's blocking task — no independent apply step needed before then
- No blockers for downstream Phase 2 plans

---
*Phase: 02-modelo-identidad-permisos*
*Completed: 2026-09-08*

## Self-Check: PASSED

All created files confirmed present on disk (`lib/db/schema/authorized-contacts.ts`,
`lib/db/schema/agent-action-catalog.ts`, `lib/db/schema/audit-log.ts`,
`drizzle/migrations/0005_phase2_identity_tables.sql`,
`drizzle/migrations/meta/0005_snapshot.json`, this SUMMARY.md). All three task
commit hashes (`cefa425`, `78ba015`, `181c66c`) confirmed present in `git log`.
