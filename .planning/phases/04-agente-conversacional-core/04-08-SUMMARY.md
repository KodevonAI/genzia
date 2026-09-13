---
phase: 04-agente-conversacional-core
plan: 08
subsystem: testing, security
tags: [real-neon-integration, postgres-rls, anthropic-sdk, seg-10, seg-05..08]

requires:
  - phase: 04-agente-conversacional-core
    plan: "04-03"
    provides: approval_queue table, audit_log.status/approvalId columns
  - phase: 04-agente-conversacional-core
    plan: "04-04"
    provides: buildAgentContext/buildAgentContextInScope, ConversationKey, AgentContext
  - phase: 04-agente-conversacional-core
    plan: "04-06"
    provides: classifyAndExecute, TOOL_TO_CATALOG_CODE, writeAuditLog, toolsFor
provides:
  - "scripts/verify-agent.ts — the real-Neon integration suite for the SEG-10 engine and the SEG-05..08 context boundary"
  - "npm run db:verify-agent (already wired by plan 04-02) as the entrypoint plan 04-12 runs live"
affects: [04-12]

tech-stack:
  added: []
  patterns:
    - "Every scope the suite opens goes through the real withResolvedIdentityContext / withSystemWebhookContext helpers, never a hand-set Postgres session variable — the proof is that RLS, not application code, confines each actor"
    - "Outbound sends are stubbed at the fetch layer (graph.facebook.com interception, counted rather than trusted absent), matching verify-whatsapp-send.ts's existing convention, so a verification run can never deliver a real WhatsApp message"
    - "Before/after call-count comparisons (Graph API calls, approval_queue row counts) prove a negative — 'no side effect occurred' — rather than inferring it from the absence of a thrown error"

key-files:
  created:
    - scripts/verify-agent.ts

key-decisions:
  - "Section 1 (context-scoping) and Section 2 (risk engine + approval_queue RLS) are two atomic commits within one file, mirroring the plan's own task split, rather than two separate scripts — the plan's <files_modified> names exactly one file and both sections share the same seeded agency, phone numbers and identities."
  - "seed(agencyId) validates every inserted id internally and returns a fully non-optional Seeded object (never string | undefined) so every downstream assertion — including ones inside nested transaction callbacks — reads a narrowed string without TypeScript's closure-narrowing limitations forcing non-null assertions throughout."
  - "The pending approval_queue row asserted against in Section 2's RLS block (18-23) is the SAME row created by test 12's draft_client_content proposal, not a freshly seeded one — this is deliberate: it proves the row a real risk-engine call produced is the row RLS then correctly scopes, rather than testing RLS against a row inserted by a shortcut."
  - "Test 17 (SEG-04 holding for an admin-initiated send) asserts on the tool_result's content string containing \"opt-in\" rather than is_error, because deliverToClient's opt-in miss is a normal (non-throwing) outcome from the tool's own execute() — the interceptor still records it as an executed low-risk action, just one that failed to deliver, matching the real code path exactly."

requirements-completed: [SEG-10, SEG-11, SEG-05, SEG-06, SEG-07]

duration: ~45m
completed: 2026-09-13
---

# Phase 4 Plan 08: Real-Neon Agent Verification Suite Summary

**`scripts/verify-agent.ts` — a 689-line, 31-assertion real-Neon integration suite proving the SEG-10 risk engine's two branches, the SEG-05..08 agent-context boundary for all four identity shapes, and the `approval_queue`'s LD-04 invisibility to the client it concerns, all against the real `buildAgentContext`, `toolsFor` and `classifyAndExecute` — never a reimplementation.**

## Performance

- **Tasks:** 2/2
- **Files created:** 1

## Accomplishments

- **Seeding harness** (`seed(agencyId)`): one agency with three team members (admin, an assigned member, an unassigned member), two clients, one `client_assignments` row, two `authorized_contacts` rows with **opposite** opt-in states (clientA's contact opted in, clientB's deliberately not — the SEG-04 negative case), and six `messages` rows via `withSystemWebhookContext` (two per client's contact, two on a team-internal thread with `client_id = NULL`). Mirrors `scripts/verify-agent-rls.ts`'s seeding shape under a separate `verify-agent-*` agency id.
- **Fetch stub**: `globalThis.fetch` is reassigned at the top of `main()` to intercept any `graph.facebook.com` URL, record the call, and return a synthetic Meta response; every other URL passes through to the original `fetch`; restored in `main()`'s `finally`. A run of this script can never deliver a real WhatsApp message.
- **Section 1 — SEG-05..08 context-scoping (8 assertions)**: calls the real `buildAgentContext(agencyId, identity, key, toolsFor(identity))` for admin, an assigned member, an unassigned member, a client contact, and an unknown sender. Proves the SEG-06 cross-client empty-context result at the agent-context level (not just SQL), the SEG-09 `AI_DISCLOSURE_RULE` containment across every produced `context.system`, and the LD-06 tool-count contract (`0` for client_contact/unknown, `2` for team_member).
- **Section 2 — SEG-10 risk engine + approval_queue RLS (23 assertions)**: calls the real `classifyAndExecute` for every one of the plan's nine scenarios — low-risk immediate execution + single audit row, high-risk queueing with a proven-zero Graph API side effect (the SEG-10 proof itself), idempotency on a repeated `tool_use_id`, the PITFALL-4/SEG-07 cross-client rejection, an unmapped tool name, and SEG-04 holding even for an admin-initiated send to an unattested contact — then reuses the queued row to prove `approval_queue`'s RLS: admin and the assigned member can read it, the unassigned member and (crucially, the LD-04 proof) the client contact whose action it concerns cannot, an unknown scope reads nothing, and a client contact's `UPDATE` affects 0 rows.

## Task Commits

1. **Task 1: Seeding harness and SEG-05..08 context-scoping assertions** - `e2b0e20` (feat)
2. **Task 2: SEG-10 risk-engine and approval_queue RLS assertions** - `fb69645` (feat)

## Files Created/Modified

- `scripts/verify-agent.ts` - seeding harness, fetch stub, `joinedText` helper, 31 `check()` assertions across the two sections described above (689 lines)

## Decisions Made

- Kept the two sections as one file with two commits (matching the plan's task split) rather than splitting into two scripts, since both sections depend on the exact same seeded agency/identities and the plan's `files_modified` names a single file.
- `seed()` throws internally on any missing id rather than returning an object with optional fields, so every field read downstream — including inside `withResolvedIdentityContext`/`withSystemWebhookContext` callback closures — is a plain `string`, avoiding TypeScript's usual "possibly undefined inside a nested function" friction without resorting to non-null assertions at every call site.
- The `approval_queue` RLS block (tests 18-23) deliberately reuses the pending row test 12's real `classifyAndExecute` call produced, rather than seeding a queue row directly — this keeps the RLS proof honestly downstream of the risk engine's own real behavior.
- Test 17 asserts on the returned tool_result's content string (`"opt-in"` substring) instead of `is_error`, because a missing opt-in is a normal `deliverToClient` outcome (returns `{ delivered: false, reason }`, does not throw), so the low branch still audits it as `executed` — this matches `lib/agent/tools/deliver-to-client.ts` and `lib/agent/risk-interceptor.ts`'s real behavior exactly rather than asserting an error path that doesn't exist in the code.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' file, exports used, and assertion counts match the plan's interfaces and acceptance criteria; `npx tsc --noEmit` and `npx eslint scripts/verify-agent.ts` both exit 0.

## Verification Performed

- `npx tsc --noEmit` — exits 0 (checked after each task's commit).
- `npx eslint scripts/verify-agent.ts` — exits 0, no warnings.
- `grep -q 'buildAgentContext('`, `grep -q 'AI_DISCLOSURE_RULE'`, `grep -q 'globalThis.fetch'` + a `finally` restoring it, `grep -q 'set_config'` returning non-zero (absent, as required — every scope opens through the real helpers) — all pass for Task 1.
- Task 1: 8 `check(` calls present (context-scoping section) — confirmed via grep.
- `grep -c 'check(' scripts/verify-agent.ts` → 31 (≥23 required); `grep -q 'classifyAndExecute('`, `grep -q 'pending_approval'`, `grep -q 'approvalQueue'`, `grep -q 'finally'` — all pass for Task 2.
- The plan's own inline `node -e` acceptance script (checks assertion count ≥ 23 and the presence of a real `classifyAndExecute(` call) — passes, reporting "ok, 31 assertions".
- `wc -l scripts/verify-agent.ts` → 689 lines (min_lines: 350 satisfied with margin).
- The script itself was **not executed** against a live database in this session, per the plan's own scope (`<verification>`: "The script is NOT executed in this plan — plan 04-12 executes it") and the task prompt's explicit instruction not to attempt a live Neon connection here.
- `git status --short` after each commit — clean, no accidental deletions or leftover untracked files.

## User Setup Required

None beyond what prior plans in this phase already documented (`DATABASE_URL`, `META_WHATSAPP_PHONE_NUMBER_ID`/`META_WHATSAPP_ACCESS_TOKEN` — the latter two are set to test fixtures inside the script itself and never used for a real send since `fetch` is stubbed). Migrations 0014-0016 must already be applied to whatever Neon database plan 04-12 points this script at before it is run live.

## Threat Flags

None — this plan's only file is a verification script exercising exactly the surface its own `<threat_model>` (T-04-39 through T-04-41) already covers: stubbed outbound sends, randomized-agency test-row isolation cleaned up in `finally`, and exact-row-count assertions rather than "not an error" inference. No new network endpoint, auth path, or schema change was introduced.

## Next Phase Readiness

`scripts/verify-agent.ts` is complete and wired to `npm run db:verify-agent` (registered by plan 04-02). Plan 04-12, the phase's live-Neon checkpoint, is the designated place this script actually runs against a real database with migrations 0014-0016 applied — at that point its 31 assertions become the first live proof that the SEG-10 engine and the SEG-05..08 context boundary hold against real Postgres RLS, not just against `tsc`.

---
*Phase: 04-agente-conversacional-core*
*Completed: 2026-09-13*

## Self-Check: PASSED

`scripts/verify-agent.ts` confirmed present on disk (689 lines), plus this SUMMARY.md. Both task commit hashes (`e2b0e20`, `fb69645`) confirmed present in `git log --oneline`.
