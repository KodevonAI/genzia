---
phase: 04-agente-conversacional-core
plan: 07
subsystem: agent, inngest
tags: [anthropic-sdk, inngest, tool-use-loop, whatsapp]

requires:
  - phase: 04-agente-conversacional-core
    plan: "04-04"
    provides: buildAgentContext, ConversationKey, AgentContext, TurnActor
  - phase: 04-agente-conversacional-core
    plan: "04-05"
    provides: downloadMedia, interpretMedia
  - phase: 04-agente-conversacional-core
    plan: "04-06"
    provides: classifyAndExecute, toolsFor
provides:
  - "runTurn / MAX_TOOL_ITERATIONS — the bounded, sequential tool-use loop (lib/agent/run-turn.ts)"
  - "processAgentTurn — the WhatsApp-triggered agent turn (inngest/functions/process-agent-turn.ts)"
  - "WhatsAppMessageReceivedData widened with messageType/resolvedIdentityRole/mediaId/mediaMimeType"
  - "AgentApprovalDecidedData / agentApprovalDecidedEvent (inngest/client.ts) for plan 04-09"
affects: [04-08, 04-09, 04-10, 04-12]

tech-stack:
  added: []
  patterns:
    - "The real agent turn is one step.run per side effect (interpret-media, persist-transcript, run-agent-turn, send-reply-via-graph-api, persist-outbound-row), so an Inngest retry after any later failure never re-sends a WhatsApp message or re-runs the LLM/tool loop"
    - "runTurn accepts an optional pre-built AgentContext so a caller that owns its own transaction (the web-chat path, plan 04-10) can bypass buildAgentContext's own scope-opening entirely"
    - "Event payloads carry every flat field a downstream Inngest step needs (role, media ids) so no step ever re-reads team_members/authorized_contacts inside a narrower system-webhook scope"

key-files:
  created:
    - lib/agent/run-turn.ts
    - inngest/functions/process-agent-turn.ts
  modified:
    - inngest/client.ts
    - app/api/webhooks/meta/route.ts
    - inngest/functions/send-whatsapp-ack.ts
    - app/api/inngest/route.ts

key-decisions:
  - "The event's resolvedIdentityRole/mediaId/mediaMimeType fields are read directly off event.data with no additional validation beyond the type union — the identity was already resolved and the media already looked up before the webhook route sent this event, so re-validating would duplicate a boundary that already ran."
  - "interpret-media's catch-all fallback ('[no se pudo procesar el archivo recibido]') is treated the same as a real transcript for the persist-transcript gate (messageType === 'audio' && interpreted.kind === 'text') — both are legitimate text_body values for the row, and LD-07's intent (later turns read text, not a media placeholder) holds for a degraded transcript too."
  - "client_contact's optInConfirmedByTeam is reconstructed as a hardcoded true when rebuilding ResolvedIdentity from the flat event payload, since the interpreter identity's read path (buildAgentContext) never checks it — only deliverToClient does, and it re-derives the real flag from authorized_contacts itself before any outbound send, so a stale/wrong value here can never bypass that check."

requirements-completed: [WA-05, SEG-09, SEG-10, SIS-01, SEG-05]

duration: ~1h30m
completed: 2026-09-13
---

# Phase 4 Plan 07: The Real Agent Turn Summary

**Replaced `send-whatsapp-ack.ts`'s fixed "Mensaje recibido" string with `processAgentTurn` — a five-step Inngest function that interprets inbound media, persists audio transcripts back onto the inbound row, runs `runTurn`'s bounded tool-use loop (composing 04-04's context builder, 04-06's SEG-10 interceptor, and 04-02's Anthropic client) under the sender's own RLS scope, sends the reply through the existing Graph API path, and persists it as history for the next turn.**

## Performance

- **Tasks:** 3/3
- **Files created:** 2
- **Files modified:** 4

## Accomplishments

- `lib/agent/run-turn.ts`: `runTurn` — the bounded, sequential loop. Calls `buildAgentContext` (unless a pre-built `context` is passed, for the future web-chat path), merges the current turn's image bytes onto the last user message rather than pushing a duplicate turn, then loops up to `MAX_TOOL_ITERATIONS = 5` extra rounds: a non-`tool_use` stop returns the joined text (or `"Listo."` if the model returned only non-text blocks); a `tool_use` stop routes every `tool_use` block through `classifyAndExecute` **sequentially** (never concurrently — two tool calls that each send a WhatsApp message must not interleave) and continues the loop with the tool results. `reportLlmFailure`/`reportLlmSuccess` wrap every `messages.create` call for the OpenRouter→Anthropic outage fallback (T-04-10). The system prompt is always the top-level `system` field, never a `{role: "system"}` message entry. Iteration exhaustion returns a fixed Spanish fallback string instead of looping forever or truncating silently (LD-13).
- `inngest/client.ts`: `WhatsAppMessageReceivedData` widened with `messageType`, `resolvedIdentityRole`, `mediaId`, `mediaMimeType` — everything `process-agent-turn.ts` needs without a second RLS-scoped read of the row it was already told about. Added `AgentApprovalDecidedData`/`agentApprovalDecidedEvent` now so plan 04-09 doesn't need to reopen this file.
- `app/api/webhooks/meta/route.ts`: dispatches the four new fields on `inngest.send(...)` using `toMessageType(message)` and the already-parsed media fields; the `result.outcome === "ingested"` idempotency gate is untouched.
- `inngest/functions/process-agent-turn.ts`: the real agent turn, five named `step.run` blocks — `interpret-media` (only when `mediaId` is present; both Meta calls inside one step since the media URL expires in 5 minutes; catches a failure into a degrading placeholder, T-04-38), `persist-transcript` (only for an audio message that produced text, writes it back to `messages.text_body` via `withSystemWebhookContext`, LD-07), `run-agent-turn` (rebuilds `ResolvedIdentity` from the flat event payload — never re-reads `team_members`, the INVARIANT `withSystemWebhookContext` documents — builds the `TurnActor`, calls `runTurn`), `send-reply-via-graph-api` (`sendWhatsAppTextMessage`), `persist-outbound-row` (copies `send-whatsapp-ack.ts`'s insert, `onConflictDoNothing` with the partial-index predicate `where: sql\`${messages.metaMessageId} is not null\`` repeated — the exact bug 03-08 found and fixed).
- `inngest/functions/send-whatsapp-ack.ts`: its `createFunction` call is removed (no longer registered anywhere), `ACK_TEXT` kept and marked `@deprecated` for D-01's own history, header rewritten to point at `process-agent-turn.ts` as its successor.
- `app/api/inngest/route.ts`: registers `processAgentTurn` in place of `sendWhatsAppAck`.

## Task Commits

1. **Task 1: lib/agent/run-turn.ts** — `d561bc9` (feat)
2. **Task 2: widen event contract + dispatch site** — `eb82bc6` (feat)
3. **Task 3: process-agent-turn.ts + retire the ack** — `bcc6a5b` (feat)

## Files Created/Modified

- `lib/agent/run-turn.ts` — `runTurn`, `MAX_TOOL_ITERATIONS`, `MAX_OUTPUT_TOKENS`, `TurnMediaInput`
- `inngest/client.ts` — widened `WhatsAppMessageReceivedData`, new `AgentApprovalDecidedData`/`agentApprovalDecidedEvent`
- `app/api/webhooks/meta/route.ts` — dispatches `messageType`/`resolvedIdentityRole`/`mediaId`/`mediaMimeType`
- `inngest/functions/process-agent-turn.ts` — `processAgentTurn`
- `inngest/functions/send-whatsapp-ack.ts` — `createFunction` call removed, `ACK_TEXT` deprecated
- `app/api/inngest/route.ts` — registers `processAgentTurn`

## Decisions Made

- Sequential (not `Promise.all`) tool execution inside `runTurn`'s loop, matching the plan's explicit T-04-36 concern: two tool calls that each send a WhatsApp message must not interleave.
- `interpret-media`'s degrade-to-placeholder catch is scoped to the whole `downloadMedia` + `interpretMedia` pair inside one `step.run`, per the plan's explicit instruction that both Meta calls must happen inside one step boundary (the media URL expires in 5 minutes).
- `persist-transcript`'s gate checks `interpreted?.kind === "text"` (not a stricter "only if it's a real transcript, not a placeholder" check) — see key-decisions above for why the placeholder text is an equally legitimate `text_body` value for LD-07's purpose.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Comment text accidentally matched the plan's own literal-string acceptance checks**

- **Found during:** Task 1 and Task 3 verification
- **Issue:** Explanatory comments in `run-turn.ts` and `send-whatsapp-ack.ts` originally contained the literal substrings `role: "system"`, `Promise.all`, `server-only`, `whatsapp/message.received`, and `createFunction` — all inside prose explaining what NOT to do or what used to be there. The plan's own `<verify><automated>` node scripts and grep-based acceptance criteria check for the ABSENCE of these exact substrings anywhere in the file (not just in executable code), so the comments caused false-positive failures against the plan's own gates.
- **Fix:** Reworded each comment to describe the same constraint without using the literal matched substring (e.g. "a message entry using the system role" instead of `{role: "system"}`; "never a concurrent fan-out" instead of `Promise.all`; "no runtime import restricting it to the server-rendering environment" instead of `server-only`; "the inbound WhatsApp event" instead of the literal event name string; "the function-registration call" instead of `createFunction`).
- **Files modified:** `lib/agent/run-turn.ts`, `inngest/functions/send-whatsapp-ack.ts`
- **Commits:** `d561bc9`, `bcc6a5b`

### Environment setup

**2. [Rule 3 - Blocking] `node_modules` was not installed in this worktree**

- **Found during:** start of Task 1 (before any grep/tsc verification could run)
- **Issue:** This git worktree had no `node_modules` — `npx tsc`/`eslint`/the `tsx`-based verify scripts would all fail immediately.
- **Fix:** Ran `npm install` (657 packages, matches `package-lock.json`) before writing any code.
- **Files modified:** none (dependency install only, no lockfile drift).

None else — plan executed exactly as written otherwise.

## Verification Performed

- `npx tsc --noEmit` — exits 0, throughout and after every task.
- `npm run lint` — exits 0.
- `npm run verify:agent-prompt` — all 10 assertions pass, no regression.
- `npm run verify:agent-media` — all 9 assertions pass, no regression.
- Task 1's plan-provided node script (`executeTool`/`{role:"system"}`/`MAX_TOOL_ITERATIONS`/`Promise.all` checks) — passes.
- Task 2's plan-provided node script (idempotency gate + media dispatch checks) — passes.
- Task 3's plan-provided node script (exactly one `whatsapp/message.received` consumer) — passes.
- All individual `<acceptance_criteria>` grep checks for all three tasks — pass.
- `git status --short` after each commit — clean, no unexpected untracked or deleted files.

## Substituted Verification (no live LLM call)

Per this plan's own `<verification>` section ("No live LLM call is made by this plan — plan 04-12 is the live checkpoint") and this session's explicit scope, `runTurn`'s actual multi-turn tool-use behavior against a real or stubbed model response was **not** additionally smoke-tested with a new script in this plan. Two reasons this was not added as a `scripts/verify-*.ts` file the way `verify-whatsapp-send.ts`/`verify-agent-media.ts` stub `fetch`:

1. The plan's own acceptance criteria for Task 1 are entirely structural (tsc, and grep/node-script assertions on the file's source — sequential execution, top-level `system` field, the interceptor as the only tool path, the iteration cap, non-empty replies). None of them assume a live or stubbed API response; substituting a mocked-fetch equivalent was only called for if the plan's criteria assumed one.
2. This session's execution scope is the single worktree touching exactly `lib/agent/run-turn.ts`, `inngest/client.ts`, `inngest/functions/process-agent-turn.ts`, `inngest/functions/send-whatsapp-ack.ts`, `app/api/inngest/route.ts`, and `app/api/webhooks/meta/route.ts` — a new `scripts/verify-run-turn.ts` would fall outside that boundary, and the sibling plan in this same wave (04-08) is the one that owns `scripts/verify-agent.ts` and is explicitly the plan meant to stub the Anthropic client for exactly this purpose.

`runTurn`'s loop logic was still verified as REAL code, not just typechecked: the plan's own node-script assertions confirm (by reading the actual source, not a stub run) that tool calls are routed exclusively through `classifyAndExecute`, run sequentially, respect the iteration cap, and never leak the system prompt into `messages`. The behavioral proof that a stubbed `client.messages.create()` round-trip actually drives this loop end-to-end (tool_use → interceptor → tool_result → next call → end_turn) is deferred to plan 04-08's real-Neon/stubbed-client integration suite, and the live proof to plan 04-12.

## User Setup Required

None beyond what prior plans in this phase already documented (`OPENROUTER_API_KEY`/`ANTHROPIC_API_KEY`, `META_WHATSAPP_PHONE_NUMBER_ID`/`META_WHATSAPP_ACCESS_TOKEN`, `DATABASE_URL`) — this plan's code doesn't introduce any new environment variable.

## Threat Flags

None — every file created or modified in this plan is exactly the surface the plan's own `<threat_model>` (T-04-33 through T-04-38) already covers: the widened event payload, the bounded tool-use loop, the five-step turn function, and the ack function's retirement. No new network endpoint, auth path, or schema change was introduced beyond what the plan specifies.

## Next Phase Readiness

`runTurn` and `processAgentTurn` are the phase's central wiring — plan 04-08's real-Neon/stubbed-client integration suite is the designated place to prove this loop actually round-trips against a stubbed Anthropic client and real Postgres RLS. Plan 04-09 (approval decision + replay) can now import `agentApprovalDecidedEvent`/`AgentApprovalDecidedData` directly. Plan 04-10 (web chat) can call `runTurn` with its own pre-built `AgentContext`, bypassing `buildAgentContext`'s WhatsApp-specific scope opening entirely, exactly as `runTurn`'s `context?` parameter was designed to allow. Plan 04-12 is the phase's live checkpoint, confirming the OpenRouter passthrough assumption (Assumption A2 in `lib/agent/client.ts`) and this whole chain against a real WhatsApp round-trip.

---
*Phase: 04-agente-conversacional-core*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 6 created/modified files confirmed present on disk (`lib/agent/run-turn.ts`, `inngest/functions/process-agent-turn.ts`, `inngest/client.ts`, `app/api/webhooks/meta/route.ts`, `inngest/functions/send-whatsapp-ack.ts`, `app/api/inngest/route.ts`), plus this SUMMARY.md. All three task commit hashes (`d561bc9`, `eb82bc6`, `bcc6a5b`) confirmed present in `git log`.
