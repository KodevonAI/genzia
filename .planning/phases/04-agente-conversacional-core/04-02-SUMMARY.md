---
phase: 04-agente-conversacional-core
plan: 02
subsystem: agent
tags: [anthropic-sdk, openrouter, deepgram, llm-client, system-prompt, seg-09]

requires:
  - phase: 02-modelo-identidad-permisos
    provides: ResolvedIdentity discriminated union, AI_DISCLOSURE_RULE (SEG-09)
provides:
  - The codebase's single LLM client construction path (getAnthropicClient),
    pointed at OpenRouter's Anthropic-compatible passthrough with a
    consecutive-failure fallback to direct Anthropic
  - MODEL_FOR_TASK model-slug map (main/cheap)
  - buildSystemPrompt with unconditional SEG-09 disclosure injection across
    all four identity branches
  - Three new env vars documented in .env.example (OPENROUTER_API_KEY,
    ANTHROPIC_API_KEY, DEEPGRAM_API_KEY)
  - Four npm verify scripts registered (owned by this plan for the whole
    phase, so sibling plans 04-01/04-05/04-08 can run in parallel without a
    package.json merge conflict)
affects: [04-agente-conversacional-core (all remaining plans in this phase import from lib/agent/)]

tech-stack:
  added: ["@anthropic-ai/sdk@0.125.0", "@deepgram/sdk@5.10.1"]
  patterns:
    - "Single client-construction module (lib/agent/client.ts) with a
      module-level consecutive-failure counter driving provider fallback —
      analogous in weight/isolation to lib/tenant/with-tenant-context.ts"
    - "System prompt built as a fixed array of sections joined by \n\n, with
      the security-critical disclosure splice unconditional and first,
      before any identity-scope branching"

key-files:
  created:
    - lib/agent/client.ts
    - lib/agent/model-for-task.ts
    - lib/agent/system-prompt.ts
    - scripts/verify-agent-prompt.ts
  modified:
    - package.json
    - package-lock.json
    - .env.example

key-decisions:
  - "Both pinned SDK versions from 04-RESEARCH.md (@anthropic-ai/sdk@0.125.0, @deepgram/sdk@5.10.1) resolved exactly against the npm registry — no version deviation to record."
  - "package.json scripts block for this whole phase (verify:agent-prompt, verify:agent-media, db:verify-agent-rls, db:verify-agent) added in this plan's Task 1 per the plan's own instruction, even though three of the four scripts point at files sibling plans create — this is the documented mechanism for letting 04-01/04-05/04-08 run in parallel without a package.json merge conflict."
  - "No live network call to OpenRouter/Anthropic/Deepgram was made or attempted anywhere in this plan, per this plan's explicit scope: the client construction code is proven correct by type-checking, linting, and grep-asserted structural invariants (exactly 2 new Anthropic() call sites, both in client.ts), not by a real API round-trip. OPENROUTER_API_KEY/ANTHROPIC_API_KEY/DEEPGRAM_API_KEY remain unprovisioned in this environment, matching 04-RESEARCH.md's Environment Availability table."

patterns-established:
  - "getAnthropicClient() is the ONLY function anywhere in the codebase allowed to construct `new Anthropic(...)` — enforced by a grep assertion in the plan's own acceptance criteria, not just convention."
  - "System prompt sections are built as a plain string array joined by \"\\n\\n\", with the disclosure rule spliced as a bare constant reference (never inside an interpolating template literal) so no future edit can accidentally reflow or paraphrase it."

requirements-completed: [SEG-09, SEG-07, SEG-05]

duration: ~25min
completed: 2026-09-13
---

# Phase 4 Plan 02: LLM Foundation (client, model map, system prompt) Summary

**Single-source Anthropic client construction pointed at OpenRouter's passthrough with a consecutive-failure fallback to direct Anthropic, plus a system-prompt builder that makes skipping SEG-09's AI-disclosure rule structurally impossible, proven by a 10/10 offline TDD suite.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3 of 3 completed
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments

- Installed `@anthropic-ai/sdk@0.125.0` and `@deepgram/sdk@5.10.1` — both exact pinned versions from 04-RESEARCH.md resolved with no deviation.
- `lib/agent/client.ts`: `getAnthropicClient()` is the single place a `new Anthropic()` client is constructed anywhere in the codebase (grep-asserted: exactly 2 call sites, both here — one for each provider branch), defaulting to OpenRouter's Anthropic-compatible passthrough (`https://openrouter.ai/api`, never the OpenAI-compatible `/api/v1` surface that silently drops `cache_control`), with `reportLlmFailure`/`reportLlmSuccess` driving a 3-consecutive-failure switch to Anthropic's own endpoint when `ANTHROPIC_API_KEY` is set, and a loud (never silent) warning when the threshold is hit without a fallback key provisioned.
- `lib/agent/model-for-task.ts`: `MODEL_FOR_TASK` map (`main`/`cheap`) as OpenRouter vendor-prefixed model slugs — a one-line change point for model selection.
- `lib/agent/system-prompt.ts`: `buildSystemPrompt` splices `AI_DISCLOSURE_RULE` verbatim, unconditionally, before any identity-scope branching, across all four `ResolvedIdentity` variants (admin, member, client_contact, unknown). The client_contact branch never mentions other clients, internal notes, profitability, or internal risk (SEG-07/SEG-08); the unknown branch states SEG-12's no-account-data/prospect-conversion framing; null `agentName`/`tone` degrade to a neutral default instead of the literal string `"null"`.
- `scripts/verify-agent-prompt.ts`: 10/10 offline assertions (no network, no DB), following the same `check()` harness style as `scripts/verify-identity-classification.ts`. TDD-executed: written first against the not-yet-existing module (confirmed RED — `MODULE_NOT_FOUND`), then `system-prompt.ts` implemented to make it pass (GREEN, 10/10 on first implementation, no refactor needed).
- `.env.example` documents `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY` with dashboard locations and an explicit warning against OpenRouter's `/api/v1` trap.
- `package.json` gained the four verify scripts this whole phase needs (`verify:agent-prompt`, `verify:agent-media`, `db:verify-agent-rls`, `db:verify-agent`), so sibling wave-1 plans (04-01/04-05/04-08) can be authored without colliding on `package.json`.

## Task Commits

1. **Task 1: Dependencies, env contract and npm verification scripts** - `5071b35` (feat)
2. **Task 2: lib/agent/client.ts and lib/agent/model-for-task.ts** - `9638c35` (feat)
3. **Task 3 (RED): failing test for SEG-09 system prompt injection** - `3f32090` (test)
3. **Task 3 (GREEN): implement buildSystemPrompt** - `6efcc7e` (feat)

_No refactor commit: the GREEN implementation passed all 10 assertions on the first attempt and needed no cleanup pass._

## TDD Gate Compliance

Task 3 followed the full RED → GREEN cycle: `3f32090` (test, confirmed failing with `MODULE_NOT_FOUND` before any implementation existed) precedes `6efcc7e` (feat, 10/10 passing). Both gate commits present in git log; REFACTOR gate omitted (not needed).

## Files Created/Modified

- `lib/agent/client.ts` - Single Anthropic client construction path, OpenRouter passthrough default, direct-Anthropic fallback after 3 consecutive failures
- `lib/agent/model-for-task.ts` - `MODEL_FOR_TASK` map (`main`/`cheap`)
- `lib/agent/system-prompt.ts` - `buildSystemPrompt` with unconditional SEG-09 injection
- `scripts/verify-agent-prompt.ts` - Offline 10-assertion proof of the above
- `package.json` - New deps (`@anthropic-ai/sdk`, `@deepgram/sdk`) and four new verify scripts
- `package-lock.json` - Lockfile update from the above install
- `.env.example` - `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY` documented

## Decisions Made

- Followed the plan as specified for all three tasks. No architectural deviations (Rule 4) were needed.
- Treated the plan's own `<critical_environment_note>`-equivalent instruction (repeated in this execution's prompt) literally: this plan's job is correct, type-checked, linted client-construction *code* and offline proof it never omits SEG-09 — not a live network call. No stubbed-fetch test was needed for Task 2 specifically because `client.ts` only *constructs* a client object; it never calls `.messages.create()` itself (that happens in `lib/agent/run-turn.ts`, a later plan in this phase), so there was no request shape to capture yet. `scripts/verify-agent.ts` (registered as `db:verify-agent`, owned by a later plan) is where that live-call verification will eventually live.

## Deviations from Plan

None - plan executed exactly as written. Both pinned dependency versions resolved exactly as specified; no Rule 1/2/3 auto-fixes were needed.

## Issues Encountered

None.

## User Setup Required

**External services require manual configuration before any real LLM call can be made** (unchanged from this plan's own `user_setup` frontmatter and 04-RESEARCH.md's Environment Availability table — this plan does not attempt to provision these, only to document and consume them correctly):
- `OPENROUTER_API_KEY` — openrouter.ai → Settings → Keys → Create Key
- `ANTHROPIC_API_KEY` (optional, fallback only) — console.anthropic.com → API Keys
- `DEEPGRAM_API_KEY` — console.deepgram.com → API Keys

None of these are provisioned in this environment or in `.env.example`'s values (only the keys/comments are documented, per this plan's scope).

## Next Phase Readiness

Every other plan in this phase (build-context, tools, risk-interceptor, run-turn, web-chat route, media/transcription) can now import `getAnthropicClient`, `MODEL_FOR_TASK`, and `buildSystemPrompt` from `lib/agent/`. The passthrough base path (`https://openrouter.ai/api`, Assumption A2) remains unverified against a live call — this is flagged in `client.ts`'s own header comment and must be confirmed the first time plan 04-12 makes a real request, per the plan's explicit instruction. No blockers for sibling wave-1 plans (04-01/04-05/04-08): `package.json` conflicts were avoided by this plan owning the whole phase's script registrations up front.

---
*Phase: 04-agente-conversacional-core*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 5 created files confirmed present on disk (`lib/agent/client.ts`,
`lib/agent/model-for-task.ts`, `lib/agent/system-prompt.ts`,
`scripts/verify-agent-prompt.ts`, this SUMMARY.md), and all 4 task commit
hashes (`5071b35`, `9638c35`, `3f32090`, `6efcc7e`) confirmed present in
`git log --oneline --all`.
