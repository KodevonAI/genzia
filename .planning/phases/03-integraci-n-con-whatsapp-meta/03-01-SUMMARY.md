---
phase: 03-integraci-n-con-whatsapp-meta
plan: 01
subsystem: database
tags: [drizzle, postgres, rls, security-definer, whatsapp]

# Dependency graph
requires:
  - phase: 02-modelo-identidad-permisos
    provides: "ResolvedIdentity contract (lib/identity/types.ts), team_members/clients/agencies schema, RLS GUC conventions (app.agency_id/app.role/app.client_id), SEG-12 finding on unknown-identity reads"
provides:
  - "messages table (D-04): raw inbound/outbound WhatsApp message log with resolved sender identity, idempotency key, and WA-07 cost columns"
  - "team_members_whatsapp_number_global_idx: platform-wide uniqueness for team member WhatsApp numbers (DEC-B)"
  - "find_agency_by_team_whatsapp_number SECURITY DEFINER function: closes the WA-04 critical architecture gap (cross-agency phone -> agency lookup for the shared internal number)"
  - "messages RLS policy pair (messages_system_webhook_all, messages_select_by_role) implementing the app.actor='system_webhook' write path (DEC-A)"
affects: ["03-02 (withSystemWebhookContext + invite-time unique violation handling)", "03-07 (WA-07 pricing backfill columns)", "03-08 (applies migrations 0012/0013 to real Neon, asserts T-03-04/T-03-05/T-03-09/T-03-10 live)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SECURITY DEFINER escape hatch for a narrow, single-scalar-column cross-tenant lookup (first use in this repo)"
    - "app.actor system-GUC as a distinct trust dimension from app.role, scoped to exactly one table's RLS policy"

key-files:
  created:
    - lib/db/schema/messages.ts
    - drizzle/migrations/0012_whatsapp_messages.sql
    - drizzle/migrations/0013_whatsapp_messages_rls.sql
    - drizzle/migrations/meta/0012_snapshot.json
  modified:
    - lib/db/schema/index.ts
    - lib/db/schema/team-members.ts
    - drizzle/migrations/meta/_journal.json

key-decisions:
  - "DEC-A: messages writes use a dedicated app.actor='system_webhook' GUC (FOR ALL policy), not withResolvedIdentityContext — keeps the webhook's legitimate unknown-identity write distinguishable from a read that SEG-12 would otherwise allow"
  - "DEC-B: team_members.whatsapp_number gets a global partial unique index so find_agency_by_team_whatsapp_number's LIMIT 1 is deterministic, not arbitrary between colliding agencies"
  - "DEC-C: WA-07 cost columns (delivery_status, conversation_id, pricing_category, pricing_billable) are real columns added now, populated by plan 03-07, deliberately with no CHECK constraint since Meta may add new statuses/pricing categories mid-platform-life"
  - "messages RLS omits DELETE grant — append-only in practice, agency deletion cascades via FK outside RLS"

requirements-completed: [WA-04, WA-07]

# Metrics
duration: 24min
completed: 2026-09-10
---

# Phase 3 Plan 01: Database Foundation for WhatsApp Integration Summary

**Drizzle `messages` table (19 columns, D-04) plus a first-of-its-kind `SECURITY DEFINER` function (`find_agency_by_team_whatsapp_number`) that closes the WA-04 cross-agency phone lookup gap, both hand-migrated in 0012/0013 but not yet applied to any database.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-09-10T18:11:00Z
- **Completed:** 2026-09-10T18:35:00Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- Declared the `messages` table in Drizzle with all D-04 columns plus DEC-C's WA-07 cost/delivery-status columns, 3 CHECK constraints, and the partial `(agency_id, meta_message_id)` idempotency index
- Added `team_members_whatsapp_number_global_idx`, the platform-wide uniqueness constraint DEC-B requires before `find_agency_by_team_whatsapp_number`'s `LIMIT 1` can be trusted
- Generated migration 0012 via `drizzle-kit generate` (table DDL, FKs, checks, both unique indexes) and hand-authored migration 0013 (RLS policy pair + the repo's first `SECURITY DEFINER` function), both journalled in order

## Task Commits

Each task was committed atomically:

1. **Task 1: Declare the messages table and the global WhatsApp unique index in Drizzle** - `4768590` (feat)
2. **Task 2: Generate migration 0012 (table DDL) with drizzle-kit** - `b063564` (feat)
3. **Task 3: Hand-author migration 0013 - messages RLS + find_agency_by_team_whatsapp_number** - `ea73d1a` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `lib/db/schema/messages.ts` - Drizzle schema for the raw WhatsApp message log (D-04), 19 columns, 3 CHECK constraints, partial unique idempotency index
- `lib/db/schema/index.ts` - Added `export * from "./messages";` barrel re-export
- `lib/db/schema/team-members.ts` - Added `team_members_whatsapp_number_global_idx` partial unique index (DEC-B)
- `drizzle/migrations/0012_whatsapp_messages.sql` - drizzle-kit-generated CREATE TABLE messages + FKs + checks + both unique indexes
- `drizzle/migrations/meta/0012_snapshot.json` - drizzle-kit snapshot for migration 0012
- `drizzle/migrations/0013_whatsapp_messages_rls.sql` - hand-authored GRANT/RLS/policy pair + `find_agency_by_team_whatsapp_number` SECURITY DEFINER function
- `drizzle/migrations/meta/_journal.json` - appended idx 12 (`0012_whatsapp_messages`) and idx 13 (`0013_whatsapp_messages_rls`) entries

## Decisions Made
- Followed the plan's three locked design decisions (DEC-A/B/C) exactly as specified — no re-litigation, no deviation.
- `npx drizzle-kit generate` produced exactly the expected statements (no unrelated DROP/ALTER) on the first attempt — no manual pruning of the generated SQL was needed.

## Deviations from Plan

None - plan executed exactly as written. All three tasks' acceptance criteria pass, including the security-sensitive ones (single-scalar-column SECURITY DEFINER return, no `app.role IN ('admin','member')` clause inside `messages_system_webhook_all`, `NULLIF(...)::uuid` idiom used for the `app.client_id` GUC comparison, journal entries in the correct order).

One documentation-only note (not a deviation): the plan's own task-level acceptance-criteria bullet `grep -c 'pgTable("messages"' lib/db/schema/messages.ts` returns 0 under a strict line-based grep because the file (matching this repo's established `audit-log.ts`/`team-members.ts` multi-line style, and the plan's own `<action>` code block) writes `pgTable(\n  "messages",` across two lines rather than one. The substance the criterion checks for (table declared, named `messages`) is fully satisfied — verified directly by reading the file and by the successful `drizzle-kit generate` output (`messages 19 columns 1 indexes 2 fks`).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. Migrations 0012/0013 are written to disk only; applying them to real Neon is explicitly plan 03-08's `[BLOCKING]` task, not this plan's.

## Next Phase Readiness
- `messages` table, its RLS policies, and `find_agency_by_team_whatsapp_number` are fully specified in Drizzle + SQL migration form, ready for plan 03-02 (`withSystemWebhookContext`) and every other plan in this phase to build against.
- Migrations 0012/0013 are NOT applied to any database yet — plan 03-08 must run `npm run db:migrate` (or equivalent) against real Neon before any of this phase's integration scripts (`scripts/verify-whatsapp-webhook.ts`, etc.) can pass.
- No blockers for Wave 2 (`03-02` onward, per ROADMAP's 4-wave structure) — this plan's `files_modified` list matches exactly what was produced.

---
*Phase: 03-integraci-n-con-whatsapp-meta*
*Completed: 2026-09-10*

## Self-Check: PASSED

All 5 created/modified files verified present on disk (`lib/db/schema/messages.ts`,
`drizzle/migrations/0012_whatsapp_messages.sql`,
`drizzle/migrations/0013_whatsapp_messages_rls.sql`,
`drizzle/migrations/meta/0012_snapshot.json`, this SUMMARY.md). All 3 task commit
hashes (`4768590`, `b063564`, `ea73d1a`) confirmed present in `git log`.
