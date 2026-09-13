---
phase: 04-agente-conversacional-core
plan: 03
subsystem: database, security
tags: [drizzle, postgres-rls, neon, approval-queue, audit-log]

requires:
  - phase: 04-agente-conversacional-core
    plan: "04-01"
    provides: audit_log_select_by_role (0014) three-branch shape this table's policies mirror
  - phase: 02-modelo-identidad-permisos
    provides: client_assignments, agent_action_catalog, ResolvedIdentity type contract
provides:
  - "lib/db/schema/approval-queue.ts: approvalQueue Drizzle table — the SEG-10 human-approval gate Phase 2 deferred"
  - "drizzle/migrations/0016_approval_queue.sql: approval_queue DDL + GRANTs + RLS (3 policies), audit_log.status/approval_id"
  - "audit_log.status/approval_id: bitácora can now distinguish executed / pending_approval / approved_executed / rejected / failed"
affects: [04-agente-conversacional-core]

tech-stack:
  added: []
  patterns:
    - "approval_queue RLS mirrors audit_log's LD-04 three-branch-minus-client_contact shape (0014), reused verbatim for both SELECT and UPDATE policies so visibility and decision rights cannot drift apart (T-04-12)"

key-files:
  created:
    - lib/db/schema/approval-queue.ts
    - drizzle/migrations/0016_approval_queue.sql
  modified:
    - lib/db/schema/audit-log.ts
    - lib/db/schema/index.ts
    - drizzle/migrations/meta/_journal.json

key-decisions:
  - "LD-04 (locked): approval_queue_select_by_role and approval_queue_decide_by_role get NO client_contact branch — a client contact must never learn an action about them is awaiting internal approval."
  - "LD-09 (locked): approval_queue carries tool_name/tool_input/client_id/conversation_phone_number/channel so a separate function (plan 04-09) can replay the tool call later, since high-risk actions are not executed by a suspended Inngest function waiting on an event."
  - "requested_by_identity_type keeps 'client_contact' as a valid enum value (mirrors ResolvedIdentity['type']) because a client contact can legitimately be the one whose message triggered a high-risk proposal (e.g. asking to reschedule) — this is orthogonal to the RLS policies having no client_contact read/decide branch."

requirements-completed: [SEG-10, SEG-11]

duration: ~1h
completed: 2026-09-13
---

# Phase 4 Plan 03: approval_queue table and audit_log shape gap Summary

**Hand-authored migration 0016 creates `approval_queue` (18 columns, 4 CHECK constraints, tool_use_id idempotency index, 3 RLS policies with no client_contact branch) and extends `audit_log` with `status`/`approval_id` so the bitácora can distinguish executed/pending/rejected/failed — closing the one gap Phase 2 explicitly deferred to Phase 4.**

## Performance

- **Tasks:** 2 of 2 completed as specified
- **Files created:** 2 (`lib/db/schema/approval-queue.ts`, `drizzle/migrations/0016_approval_queue.sql`)
- **Files modified:** 3 (`lib/db/schema/audit-log.ts`, `lib/db/schema/index.ts`, `drizzle/migrations/meta/_journal.json`)

## Accomplishments

- `lib/db/schema/approval-queue.ts`: `approvalQueue` table with all 18 columns from the plan's spec (id, agency_id, client_id, action_type_code, risk_level, tool_name, tool_use_id, tool_input jsonb, status, summary, requested_by_identity_type, requested_by_identity_id, channel, conversation_phone_number, decided_by_team_member_id, decided_at, execution_result, created_at), 4 named CHECK constraints, and `approval_queue_agency_id_tool_use_id_idx` unique index for interceptor idempotency (`onConflictDoNothing` target for plan 04-09/04-06's writer).
- `lib/db/schema/audit-log.ts`: added `status` (default `'executed'`, CHECK in `executed`/`pending_approval`/`approved_executed`/`rejected`/`failed`) and `approval_id` (nullable FK to `approvalQueue.id`, `ON DELETE SET NULL`).
- `lib/db/schema/index.ts`: exports `./approval-queue` after `./audit-log`, per the plan's explicit ordering instruction.
- `drizzle/migrations/0016_approval_queue.sql`: hand-written (not `drizzle-kit generate`, per the plan and the same reasoning 0001/0006/0013/0014/0015 give). Creates the table with its 4 CHECK + 4 FK constraints, the unique index, the two `audit_log` ALTER statements, `GRANT SELECT, INSERT, UPDATE` (no DELETE) to `app_user`, `ENABLE`/`FORCE ROW LEVEL SECURITY`, and 3 policies:
  - `approval_queue_system_all` (`FOR ALL`, keyed on `app.actor = 'system_webhook'`) — same rationale as 0013's `messages_system_webhook_all`.
  - `approval_queue_select_by_role` (`FOR SELECT`) — admin unconditional, member gated by `client_id IS NULL OR client_id IN (SELECT client_id FROM client_assignments WHERE team_member_id = NULLIF(current_setting('app.team_member_id', true), '')::uuid)`, no client_contact branch.
  - `approval_queue_decide_by_role` (`FOR UPDATE`) — identical predicate reused for both `USING` and `WITH CHECK`, so a human's visibility and decision rights on a row cannot drift apart (T-04-12).
- Journal appended at idx 16, tag `0016_approval_queue`, `when` strictly greater than 0015's. Not applied to any database — real-Neon application is plan 04-12's job.
- `npx tsc --noEmit` exits clean with the new/modified schema files in place.

## Task Commits

1. **Task 1: approval-queue.ts and audit_log column additions** - `4453d20` (feat)
2. **Task 2: migration 0016** - `209c17e` (feat)

## Files Created/Modified

- `lib/db/schema/approval-queue.ts` - `approvalQueue` table (created)
- `lib/db/schema/audit-log.ts` - added `status`/`approvalId` columns and `audit_log_status_check`
- `lib/db/schema/index.ts` - added `export * from "./approval-queue"`
- `drizzle/migrations/0016_approval_queue.sql` - full DDL/GRANT/RLS migration (created)
- `drizzle/migrations/meta/_journal.json` - appended idx 16 entry

## Decisions Made

- Followed 0014's exact three-branch-minus-client_contact RLS shape for both `approval_queue_select_by_role` and `approval_queue_decide_by_role`, reusing the identical predicate in both `USING` and `WITH CHECK` of the decide policy per the plan's explicit instruction ("same predicate reused for the UPDATE policy so visibility and decision rights cannot drift apart") — this is standard, necessary practice for UPDATE policies (without `WITH CHECK`, Postgres would fall back to using the `USING` clause for both directions, but writing it explicitly documents the invariant and matches `approval_queue_system_all`'s own `USING`/`WITH CHECK` pair).
- Kept `requested_by_identity_type`'s CHECK enum including `'client_contact'` because the column mirrors `ResolvedIdentity["type"]` (per the plan's own Task 1 column spec and `interfaces` section) and records *who requested* the proposed action, not who may read/decide it — a client contact's own message can legitimately trigger a high-risk proposal (e.g. "reagenda mi cita"). This is a different axis from the RLS policies' visibility branches, which correctly have zero client_contact reference.
- Moved all LD-04/client_contact rationale prose into the migration's header comment block (before `CREATE TABLE`, matching 0014's convention) rather than repeating it inline next to each policy, keeping the policy-adjacent comments free of the literal string except where structurally unavoidable (see Deviations).

## Deviations from Plan

### Auto-fixed Issues (Rule 1 — plan's own automated-verification defect)

**1. Task 2's literal `<verify><automated>` script cannot pass without breaking correct schema design; implemented correctly and documented instead of forcing the naive check to pass.**
- **Found during:** Task 2, running the plan's exact verify script against the finished migration.
- **Issue:** The plan's Task 1 column spec requires `requested_by_identity_type`'s CHECK constraint to include `'client_contact'` as a valid enum value ("mirrors `ResolvedIdentity["type"]`, CHECK in ('team_member','client_contact','unknown')" — matching `messages.resolved_identity_type`'s existing convention). But Task 2's acceptance criterion and its literal automated verify script assert `!/client_contact/.test(body)` where `body = s.slice(s.indexOf('CREATE TABLE'))` — i.e., the string `client_contact` must not appear anywhere in the migration from `CREATE TABLE` onward, including inside CHECK constraints. These two instructions are mutually exclusive: any DDL that correctly encodes the required enum value will always fail the literal string-absence check, regardless of comment placement.
- **Investigation:** Confirmed the actual security-relevant guarantee (T-04-11: "No `client_contact` branch in any of the three policies") is about the RLS **policies**, not the table's data columns — 0014's own header for `audit_log` draws exactly this same distinction (audit_log has no client_contact column at all, so no conflict arose there; `approval_queue` is the first table where a column legitimately needs the literal enum value while the policies must not reference it). Verified directly: extracting only the 3 `CREATE POLICY ... ;` statement bodies and checking each for `client_contact` returns zero matches in all three — the actual mitigation holds.
- **Fix:** Kept the schema-correct CHECK constraint (`'team_member', 'client_contact', 'unknown'`) matching Task 1's own spec and the `messages` table's existing precedent. Moved all LD-04 explanatory prose into the header comment (before `CREATE TABLE`, matching 0014's convention) so the only remaining occurrence of the string in the migration body is the single, necessary, structurally-required CHECK constraint value — not a policy branch.
- **Files affected:** `drizzle/migrations/0016_approval_queue.sql`
- **Commit:** `209c17e`

**2. Task 2's acceptance criterion `grep -c "NULLIF(current_setting('app.team_member_id', true), '')::uuid"` expects 2, actual correct count is 3.**
- **Found during:** Task 2, running `grep -c` per the acceptance criteria.
- **Issue:** The plan's own step 11 instructs the decide policy's `WITH CHECK` clause to repeat "the exact predicate from step 10" verbatim, and step 10's predicate itself contains the `NULLIF(...)` pattern once. A correct implementation therefore has the pattern once in `approval_queue_select_by_role` and twice in `approval_queue_decide_by_role` (once in `USING`, once in `WITH CHECK`, as PostgreSQL requires both to be specified explicitly for an UPDATE policy to close the pre/post-update gap) — 3 occurrences total, not 2. This mirrors `approval_queue_system_all`'s own `USING`/`WITH CHECK` pair earlier in the same file, which also duplicates its predicate.
- **Fix:** Implemented per the plan's literal step-10/step-11 instructions (predicate duplicated in both `USING` and `WITH CHECK` of the decide policy). The miscount is in the acceptance criterion's arithmetic, not in the SQL. No RLS behavior was changed to force this number to 2, since doing so would mean omitting `WITH CHECK` from an UPDATE policy — a real security gap (a row could be updated into a state that no longer belongs to the updater's own predicate without being rejected).
- **Files affected:** `drizzle/migrations/0016_approval_queue.sql`
- **Commit:** `209c17e`

No other deviations. All other acceptance criteria (`npx tsc --noEmit` exit 0, `approval_queue_agency_id_tool_use_id_idx` present, 4+ `check(` calls, `jsonb` present, `approvalId`/`pending_approval` in audit-log.ts, `./approval-queue` exported, 3 `CREATE POLICY` statements, `approval_queue_system_all` present, `GRANT SELECT, INSERT, UPDATE ON approval_queue TO app_user` with no DELETE grant, `audit_log_status_check` present, journal idx 16 tag `0016_approval_queue`) pass exactly as specified.

## Verification Performed

- `npx tsc --noEmit` — exits 0.
- `node -e ...` checks for all Task 1 acceptance criteria (unique index string, CHECK count = 4, `jsonb` present, `approvalId`/`pending_approval` in audit-log.ts, `./approval-queue` exported) — all pass.
- `node -e ...` checks for Task 2 acceptance criteria: 3 `CREATE POLICY` statements, `approval_queue_system_all` present, `GRANT SELECT, INSERT, UPDATE ON approval_queue TO app_user` present with no `DELETE` grant, `audit_log_status_check` present, journal last entry `{idx:16, tag:"0016_approval_queue"}` — all pass.
- Custom verification isolating the 3 `CREATE POLICY ... ;` statement bodies and confirming zero of them reference `client_contact` — confirms the actual T-04-11 mitigation independent of the plan's over-broad literal check (see Deviations #1).
- Migration NOT applied to any database (Neon or otherwise) by this plan — confirmed no `db:migrate`/`psql`/Neon SQL Editor commands were run.

## Deferred to Plan 04-12 (real-Neon application)

Per this session's explicit instructions, this plan does not apply migration 0016 to real Neon — that is plan 04-12's job (the phase's final checkpoint plan). Deferred to 04-12:
- Applying migration 0016 to the live Neon database.
- Running any real-Postgres verification of `approval_queue`'s RLS policies (e.g., a `scripts/verify-*.ts` proving the three policies behave as written against live rows — no such script exists yet; plan 04-08 or 04-12 may add one).
- Confirming `audit_log.status`/`audit_log.approval_id` round-trip correctly against real data once agent code (later plans in this phase) starts writing them.

## User Setup Required

None. Both schema changes are pure TypeScript/SQL, not applied to any database by this plan.

## Threat Flags

None — all files created/modified in this plan (`lib/db/schema/approval-queue.ts`, `lib/db/schema/audit-log.ts`, `lib/db/schema/index.ts`, `drizzle/migrations/0016_approval_queue.sql`, `drizzle/migrations/meta/_journal.json`) are exactly the surface the plan's own `<threat_model>` (T-04-11 through T-04-15) already covers. No new network endpoints, auth paths, or trust-boundary-crossing schema changes beyond what the plan specifies.

## Next Phase Readiness

`approvalQueue` and the extended `auditLog` shape are now available for every later Phase 4 plan to import from `lib/db/schema`. The risk interceptor (plan 04-06), the approval Server Action and replay function (plan 04-09), and the approval dashboard UI (plan 04-08) can all build against this stable shape. No plan in this phase should apply migration 0016 to a live database before 04-12 confirms it behaves as written against real Neon, alongside 0014/0015 which are also still unapplied.

---
*Phase: 04-agente-conversacional-core*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 6 created/modified files confirmed present on disk (`lib/db/schema/approval-queue.ts`, `drizzle/migrations/0016_approval_queue.sql`, `lib/db/schema/audit-log.ts`, `lib/db/schema/index.ts`, `drizzle/migrations/meta/_journal.json`, this SUMMARY.md). Both task commit hashes (`4453d20`, `209c17e`) confirmed present in `git log`.
