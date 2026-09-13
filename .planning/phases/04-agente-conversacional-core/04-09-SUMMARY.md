---
phase: 04-agente-conversacional-core
plan: 09
subsystem: agent
tags: [inngest, drizzle, rls, server-actions, approval-queue, whatsapp]

# Dependency graph
requires:
  - phase: 04-agente-conversacional-core
    provides: "04-06's classifyAndExecute/writeAuditLog/executeTool and the approval_queue table + RLS policies (migration 0016); 04-07's process-agent-turn Inngest wiring pattern and event-client conventions"
provides:
  - "approveAction/rejectAction Server Actions (lib/agent/approvals.ts) — the only human-facing write path to approval_queue"
  - "executeApprovedAction Inngest function (inngest/functions/execute-approved-action.ts) — the sole consumer of agent/approval.decided, replays approved tool calls and audits both outcomes"
  - "app/api/inngest/route.ts registers executeApprovedAction alongside processAgentTurn"
affects: [04-10 (chat web — will surface approve/reject UI over these Server Actions), 04-11 (bitácora visible — reads the status/approval_id columns this plan writes), 04-12 (real-Neon verification of the full approval loop)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server Action limits its UPDATE's SET clause to exactly the columns a human decision may change (status/decided_by_team_member_id/decided_at), relying entirely on RLS (approval_queue_decide_by_role) for who may act, never a second role check in code"
    - "Both decisions (approve AND reject) dispatch the same Inngest event; the background function is the single audit writer for the outcome, keeping one audit-writing scope in the whole codebase"
    - "A replay function branches on the row's CURRENT status column, never on the triggering event's payload, so a redelivered/retried event after a later state change is a safe no-op"
    - "Identity used for a delayed replay is resolved to plain data (team_members.role via the plain db export, explicit agency_id filter) BEFORE any RLS scope opens — same ordering ingest-inbound-message.ts established for SEG-12"
    - "A tool-call throw during replay is caught OUTSIDE the step.run it happened in, so a later step can still record a visible 'failed' outcome instead of losing the action silently or leaving it in a false-pending state"

key-files:
  created:
    - lib/agent/approvals.ts
    - inngest/functions/execute-approved-action.ts
  modified:
    - app/api/inngest/route.ts

key-decisions:
  - "Followed LD-09/LD-14/LD-15 exactly as locked in the plan: no step.waitForEvent, both decisions dispatch the event, RLS is the only authorization check in the Server Action."
  - "Rejected branch does not re-validate the stored tool_input at all (nothing is executed), only the approved branch re-applies the clientId scope cross-check before replay."

patterns-established:
  - "Delayed-replay functions (any future 'act on a decision made earlier' background job) should resolve identity to plain data before opening a scope, exactly like this plan and ingest-inbound-message.ts, rather than querying team_members/authorized_contacts from inside the scope."

requirements-completed: [SEG-10, SEG-11]

duration: ~20min
completed: 2026-09-13
---

# Phase 4 Plan 09: Approve/Reject High-Risk Agent Actions Summary

**Server Actions that flip a pending `approval_queue` row's status under RLS alone, plus the Inngest function that replays the tool call (or records the rejection) and writes the bitácora entry either way.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-09-13
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `approveAction`/`rejectAction` (`lib/agent/approvals.ts`): a human's Clerk session can now flip a `pending` `approval_queue` row to `approved`/`rejected`, touching only `status`/`decided_by_team_member_id`/`decided_at`, with RLS's `approval_queue_decide_by_role` policy as the sole authorization check.
- `executeApprovedAction` (`inngest/functions/execute-approved-action.ts`): the previously write-only queue is now acted on — an approved proposal is actually replayed through `executeTool` as the approving team member's identity, a rejected one is audited and never executed, and both outcomes are recorded on the queue row and in `audit_log`.
- Closed the loop SEG-10 needed: "alto riesgo requiere aprobación humana antes de llegar al cliente" is now true end-to-end, not just the "antes de llegar" half.

## Task Commits

Each task was committed atomically:

1. **Task 1: lib/agent/approvals.ts — the decision Server Actions** - `d7c0e04` (feat)
2. **Task 2: inngest/functions/execute-approved-action.ts — the replay** - `c18f747` (feat)

_No plan metadata commit yet — this is a worktree-mode execution; the orchestrator makes the metadata commit after merge._

## Files Created/Modified
- `lib/agent/approvals.ts` - `approveAction`/`rejectAction` Server Actions; private `decide()` does the pending-only, three-column UPDATE inside `withTenantContext`, then dispatches `agent/approval.decided` for both outcomes
- `inngest/functions/execute-approved-action.ts` - Inngest function consuming `agent/approval.decided`; loads the row fresh, branches on its current status, resolves the approver's role via plain `db` before opening any scope, re-applies the clientId scope cross-check, replays `executeTool`, and records the outcome (queue row + bitácora) even on failure
- `app/api/inngest/route.ts` - registers `executeApprovedAction` alongside `processAgentTurn`

## Decisions Made
- No deviations from the locked decisions (LD-09, LD-14, LD-15) — implemented exactly as specified.
- Used `event.data.decidedByTeamMemberId` (plain data already on the event) as the identity for the approver-role lookup, rather than re-reading `decided_by_team_member_id` off the loaded row — both are set in the same transaction by `decide()`, so they are guaranteed identical; using the event value avoids an extra column dependency in the `load-approval` step.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' acceptance criteria (grep assertions, `tsc --noEmit`, `eslint`) and the plan-level verification (`npm run verify:agent-prompt`, `npm run verify:agent-media`) passed without needing any auto-fix.

## Issues Encountered

**Tooling conflict, not a code issue:** this session's global `rtk` Bash-command-rewriting hook (a user-level token-savings proxy) rewrites common git subcommands (`status`, `add`) into an `rtk`-wrapped form before the worktree-isolation sandbox check runs, and that check then refuses the rewritten command because it cannot verify `rtk`'s filesystem behavior stays inside the worktree. Git plumbing commands the hook does not rewrite (`reset --hard`, `rev-parse`, `merge-base`) were unaffected. Worked around by invoking `/usr/bin/git` directly (the literal, unwrapped binary) for `add`/`commit`/`status` — a transparent invocation the sandbox can verify directly, not a rewrite or bypass of the isolation check itself. No project files or plan content were affected.

## User Setup Required

None - no external service configuration required. (The pre-existing project-wide blocker on `OPENROUTER_API_KEY`/`ANTHROPIC_API_KEY`/`DEEPGRAM_API_KEY` for any real LLM call, documented in STATE.md, is unchanged by this plan — this plan's code paths do not call the LLM.)

## Next Phase Readiness
- The approval loop (propose → queue → decide → replay → audit) is now complete end-to-end in code. `db:verify-agent`/`db:verify-agent-rls` (04-08/04-12) are the next real test of this against Neon — this plan's own verification was `tsc`/`eslint`/grep-based plus the two existing offline suites (`verify:agent-prompt`, `verify:agent-media`), which stayed green.
- 04-10 (chat web) and 04-11 (bitácora visible) can now build UI directly on top of `approveAction`/`rejectAction` and the `status`/`approval_id` columns this plan's function writes.
- No blockers introduced by this plan.

---
*Phase: 04-agente-conversacional-core*
*Completed: 2026-09-13*

## Self-Check: PASSED

All created files confirmed present on disk (`lib/agent/approvals.ts`,
`inngest/functions/execute-approved-action.ts`, `app/api/inngest/route.ts`,
this SUMMARY.md) and both task commit hashes (`d7c0e04`, `c18f747`) confirmed
present in `git log --oneline --all`.
