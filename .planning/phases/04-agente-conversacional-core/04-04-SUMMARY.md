---
phase: 04-agente-conversacional-core
plan: 04
subsystem: api, database
tags: [drizzle, postgres-rls, anthropic-sdk]

requires:
  - phase: 04-agente-conversacional-core
    provides: "getAnthropicClient (04-02), buildSystemPrompt (04-02), messages_select_by_role three-branch RLS (04-01)"
provides:
  - "ConversationKey/AgentContext/TurnActor type contracts (lib/agent/types.ts)"
  - "toAnthropicMessages history converter (lib/agent/to-anthropic-messages.ts)"
  - "buildAgentContext/buildAgentContextInScope — the only reader of messages/agent_brand_config for agent turns"
affects: [04-06, 04-07, 04-08, 04-10]

tech-stack:
  added: []
  patterns: ["a security-critical reader takes an already-scoped tx and never opens its own scope, so both the WhatsApp and web-chat entry points can share it"]

key-files:
  created:
    - lib/agent/types.ts
    - lib/agent/to-anthropic-messages.ts
    - lib/agent/build-context.ts

key-decisions:
  - "No client_id predicate and no role branch in build-context.ts's history query — migration 0015's RLS policy is the only boundary. Adding an app-level filter here would mask a broken policy instead of failing loudly (SEG-05)."
  - "buildAgentContextInScope is exported separately from buildAgentContext so the web-chat path (04-10) can call it inside a withTenantContext transaction, since withTenantContext is server-only and this module deliberately is not."

patterns-established:
  - "Security-critical context builders take an already-scoped transaction argument rather than opening their own scope, so multiple entry points (phone-resolved identity, Clerk session) can share one implementation without either one importing the other's runtime-restricted helper."

requirements-completed: [SEG-05, SEG-06, SEG-07, SEG-08, SIS-01]

duration: ~45min
completed: 2026-09-13
---

# Phase 4: Agente Conversacional Core — Plan 04-04 Summary

**`buildAgentContext`, the single security-critical function permitted to read `messages`/`agent_brand_config` for agent turns, with a 40-message history cap and zero application-level client filtering.**

## Performance

- **Tasks:** 2/2
- **Files modified:** 3 created

## Accomplishments

- `lib/agent/types.ts`: `ConversationKey` (the only way a conversation is addressed — phone number for WhatsApp, team member id for web), `AgentContext`, `TurnActor`.
- `lib/agent/to-anthropic-messages.ts`: converts a chronological row slice from `messages` into `Anthropic.Messages.MessageParam[]`.
- `lib/agent/build-context.ts`: `buildAgentContextInScope` (core reader, takes an already-scoped tx) and `buildAgentContext` (opens `withResolvedIdentityContext` and calls the former) — reads brand config, a capped 40-row history with no client filter, builds the system prompt via `buildSystemPrompt`, and derives `clientId` from the resolved identity.

## Task Commits

1. **Task 1: types.ts + to-anthropic-messages.ts** - `3639114` (feat)
2. **Task 2: build-context.ts** - `fa4e98f` (feat)

## Files Created/Modified

- `lib/agent/types.ts` - `ConversationKey`, `AgentContext`, `TurnActor`
- `lib/agent/to-anthropic-messages.ts` - history-row → Anthropic message converter
- `lib/agent/build-context.ts` - `buildAgentContextInScope`, `buildAgentContext`

## Decisions Made

- History query's ONLY predicates are `agency_id` plus a channel-specific conversation-identity match (WhatsApp: counterpart phone on either side; web: `resolved_identity_id = teamMemberId`) — no `client_id`, no role check. Migration 0015 (04-01)'s three-branch RLS is the actual boundary; this function fails loudly (wrong rows) rather than quietly narrowing itself if that policy ever regresses.
- `buildAgentContextInScope` deliberately omits `import "server-only"`, matching `with-resolved-identity-context.ts` and `client.ts`, so the `tsx`-run verification scripts (04-08) can import it directly.

## Deviations from Plan

None — plan executed exactly as written, across two sessions (a stalled first attempt left Task 1 committed and Task 2's file written-but-uncommitted; this session verified the existing `build-context.ts` content against every acceptance criterion, found it already correct, and committed it rather than rewriting).

## Issues Encountered

The first execution attempt stalled (no progress for 600s) after writing `build-context.ts` but before committing it or verifying acceptance criteria. Recovered by inspecting the worktree directly: Task 1's commit was intact, `build-context.ts`'s content matched the plan's spec exactly. Ran all acceptance criteria and the `<verify><automated>` command fresh — all passed — then committed. No content was rewritten, only verified and committed.

## User Setup Required

None beyond what 04-02 already documented (`OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` / `DEEPGRAM_API_KEY` unprovisioned — this plan's code doesn't call any of those directly, `buildSystemPrompt` and the Anthropic SDK types are used at the type level only).

## Next Phase Readiness

`buildAgentContext` is ready for 04-06 (risk interceptor / tool registry) and 04-07 (`runTurn`) to consume. 04-08's real-Neon integration suite is the first place the SEG-05/06/07/08 boundary this function relies on gets proven end-to-end against live Postgres — this plan's own verification was necessarily static (tsc/eslint/grep), not a live RLS proof.

---
*Phase: 04-agente-conversacional-core*
*Completed: 2026-09-13*
