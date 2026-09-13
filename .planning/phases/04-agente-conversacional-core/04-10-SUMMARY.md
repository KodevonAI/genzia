---
phase: 04-agente-conversacional-core
plan: 10
subsystem: api, database, web
tags: [drizzle, postgres-rls, nextjs, next-intl, web-chat]

requires:
  - phase: 04-agente-conversacional-core
    plan: "04-04"
    provides: buildAgentContextInScope, ConversationKey
  - phase: 04-agente-conversacional-core
    plan: "04-07"
    provides: "runTurn (the context?/currentTurnMedia? parameters designed for this exact caller)"
provides:
  - "messages_web_chat_insert RLS policy + messages_channel_check / messages_whatsapp_phone_numbers_check (migration 0017)"
  - "sendWebChatTurn (lib/agent/web-chat.ts) — the Clerk-scoped counterpart to processAgentTurn"
  - "POST /api/chat — the web-chat HTTP endpoint"
  - "/dashboard/chat — the team's conversation surface with the agent"
affects: [04-11, 04-12]

tech-stack:
  added: []
  patterns:
    - "The web-chat entry point opens two separate withTenantContext transactions (inbound row + context build, then outbound row) with runTurn called strictly between them, mirroring processAgentTurn's step boundaries but without Inngest — there is no retry/idempotency layer on this path, a plain synchronous HTTP request is all LD-08 (non-streaming) asks for"

key-files:
  created:
    - drizzle/migrations/0017_web_chat_messages.sql
    - lib/agent/web-chat.ts
    - app/api/chat/route.ts
    - app/[locale]/dashboard/chat/page.tsx
    - app/[locale]/dashboard/chat/chat-panel.tsx
  modified:
    - lib/db/schema/messages.ts
    - drizzle/migrations/meta/_journal.json
    - app/[locale]/dashboard/layout.tsx
    - messages/es.json
    - messages/en.json

key-decisions:
  - "sendWebChatTurn resolves agencyId/role from inside the first withTenantContext transaction via current_setting('app.agency_id'/'app.role'), the same pattern app/api/uploads/brand-logo/route.ts already uses, rather than calling Clerk's auth() a second time outside withTenantContext."
  - "The outbound row is persisted in a SECOND withTenantContext call rather than reusing the first transaction's handle — the first transaction closes before runTurn is called (T-04-50: an LLM call must never hold a Postgres transaction open), so there is no open transaction left to reuse by the time the reply exists."
  - "middleware.ts needed NO change: /api/chat is not in the public-route allowlist, so it is already inside the Clerk-authenticated area by default — verified by reading the matcher, not assumed."

requirements-completed: [WA-05, SIS-01, SEG-09, SEG-05]

duration: ~1h15m
completed: 2026-09-13
---

# Phase 4 Plan 10: Web Chat Summary

**Migration 0017 makes `messages` accept a team-only `channel='web'` row pinned to its author by RLS; `sendWebChatTurn`/`POST /api/chat`/`/dashboard/chat` give the team a real, persisted, multimodal conversation surface that runs through the exact same `runTurn` the WhatsApp path uses.**

## Performance

- **Tasks:** 3/3
- **Files created:** 5
- **Files modified:** 5

## Accomplishments

- `drizzle/migrations/0017_web_chat_messages.sql` + `lib/db/schema/messages.ts`: `from_phone_number`/`to_phone_number` are now nullable (the WhatsApp invariant moved to `messages_whatsapp_phone_numbers_check`), `messages_channel_check` closes `channel` to `'whatsapp'`/`'web'`, and `messages_web_chat_insert` is a new INSERT policy that requires a staff `app.role` and pins `resolved_identity_id` to the caller's own `app.team_member_id` — a team member cannot write a web row attributed to someone else, and a `client_contact` scope matches no branch (LD-02/LD-16/T-04-47/T-04-48).
- `lib/agent/web-chat.ts`: `sendWebChatTurn` — interprets any attachment (image or audio) before opening a transaction, inserts the inbound row and builds the `AgentContext` inside one `withTenantContext` transaction, calls `runTurn` strictly between two transactions (never inside one, T-04-50), then persists the outbound row in a second transaction.
- `app/api/chat/route.ts`: `POST` validates the JSON body (400 on missing/oversized text with no attachment), maps `NoTenantContextError` to 401, `{ok:false}` to 400, and any other thrown error to a generic 500 with no provider body or env value (T-04-51) — same posture as `send-message.ts`.
- `/dashboard/chat`: a Server Component page that loads the caller's own persisted web-chat history (channel `'web'`, `resolved_identity_id = member.id`, capped 50, most-recent-first then reversed to chronological) through `withTenantContext`, and a client `ChatPanel` with optimistic send, an image/audio attachment input (5 MB/16 MB client-side ceilings, explicitly convenience-only), a "pensando..." thinking state, and role-distinct message bubbles. Nav link + `Chat` i18n namespace added to both `messages/es.json` and `messages/en.json`.

## Task Commits

1. **Task 1: Migration 0017 — make the web channel writable** — `eaffd42` (feat)
2. **Task 2: lib/agent/web-chat.ts and POST /api/chat** — `80b554d` (feat)
3. **Task 3: Dashboard chat page** — `60d06ba` (feat)

## Files Created/Modified

- `drizzle/migrations/0017_web_chat_messages.sql` — nullable phone columns, two new CHECK constraints, `messages_web_chat_insert`
- `lib/db/schema/messages.ts` — schema updated to match 0017, header comment extended with LD-16/LD-02
- `drizzle/migrations/meta/_journal.json` — idx 17 entry appended
- `lib/agent/web-chat.ts` — `sendWebChatTurn`, `WebChatInput`, `WebChatResult`
- `app/api/chat/route.ts` — `POST`
- `app/[locale]/dashboard/chat/page.tsx` — `ChatPage` (Server Component)
- `app/[locale]/dashboard/chat/chat-panel.tsx` — `ChatPanel` (Client Component)
- `app/[locale]/dashboard/layout.tsx` — nav link to `/dashboard/chat`
- `messages/es.json` / `messages/en.json` — `Chat` namespace + `Dashboard.nav.chat`

## Decisions Made

- `sendWebChatTurn` derives `agencyId`/`role` from `current_setting('app.agency_id'/'app.role')` inside the already-open `withTenantContext` transaction rather than calling Clerk's `auth()` a second time — identical to the pattern `app/api/uploads/brand-logo/route.ts` already established for the same "the GUC withTenantContext already set is the source of truth, don't re-derive it" reasoning.
- The outbound row write opens a second, separate `withTenantContext` transaction. The alternative — holding the first transaction's handle across the `runTurn` call — is exactly what T-04-50 (and `run-turn.ts`'s own header comment) forbids: an LLM call has unbounded latency and must never hold a Postgres transaction open.
- `middleware.ts` required no change. Verified by reading its `isPublicRoute` matcher: `/api/chat` is not in the allowlist, so `clerkMiddleware`'s default `auth.protect()` already covers it. This is exactly the class of bug Phase 1 found for `/api/uploads/brand-logo` (excluded by an old blanket `/api/*` exclusion) — this session confirmed no such blanket exclusion exists in the current `middleware.ts` before concluding no fix was needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A comment in `lib/agent/web-chat.ts` accidentally matched the plan's own literal-string acceptance check**

- **Found during:** Task 2 verification (the plan's own `<verify><automated>` node script)
- **Issue:** The file's header comment originally said "...instead of `withResolvedIdentityContext` (phone-resolved identity)" to explain the contrast with the WhatsApp path. The plan's acceptance criteria assert `grep -q 'withResolvedIdentityContext' lib/agent/web-chat.ts` returns non-zero (this file must never mention the phone-scoped helper at all, even in prose) — the same class of false-positive 04-07's SUMMARY documents for its own files.
- **Fix:** Reworded to "the phone-resolved-identity scope the WhatsApp path uses" — same meaning, no literal match.
- **Files modified:** `lib/agent/web-chat.ts`
- **Commit:** `80b554d`

**2. [Rule 3 - Blocking] `node_modules` was not installed in this worktree**

- **Found during:** Start of Task 1, before any `tsc`/`eslint`/`build` verification could run
- **Issue:** This git worktree had no `node_modules` at all.
- **Fix:** Ran `npm install` (657 packages, matches `package-lock.json`).
- **Files modified:** None (dependency install only, no lockfile drift).

**3. [Rule 3 - Blocking] `npm run build` failed for an unrelated pre-existing route, not this plan's code**

- **Found during:** Task 3's `npm run build` acceptance check
- **Issue:** No `.env.local` existed in this worktree. `next build`'s page-data collection step imports `app/api/webhooks/clerk/route.ts`'s module graph, which pulls in `lib/db/index.ts` — that module throws synchronously at import time if `DATABASE_URL` is unset. This is unrelated to any file this plan touches; it is the same pre-provisioned-env gap `STATE.md` already documents for `OPENROUTER_API_KEY`/`ANTHROPIC_API_KEY`/`DEEPGRAM_API_KEY`, just for `DATABASE_URL`/Clerk/R2/Meta vars this time, surfaced by `next build` actually evaluating every route's module graph (unlike `tsc --noEmit`, which only type-checks).
- **Fix:** Created a git-ignored `.env.local` (confirmed `.env*` is gitignored except `.env.example`) with placeholder values for every variable `.env.example` lists, sufficient for module-eval-time checks to pass. No real credential was used or is required for a structural build check — this is exactly the same class of substitution 04-08/04-07 note for their own `tsx`-run verification scripts. The placeholder `.env.local` is local-only and was never staged or committed.
- **Files modified:** None tracked (untracked, gitignored `.env.local` only).

None else — plan executed exactly as written otherwise.

## Verification Performed

- `npx tsc --noEmit` — exits 0, after every task.
- `npm run lint` — exits 0.
- `npm run build` — exits 0, `/api/chat` and `/dashboard/chat` both appear in the route list.
- `npm run verify:agent-prompt` — 10/10 assertions pass, no regression.
- `npm run verify:agent-media` — 9/9 assertions pass, no regression.
- All individual `<acceptance_criteria>` grep/node checks for all three tasks — pass, including the plan's own inline node scripts for 0017's SQL content, `web-chat.ts`'s structural constraints (`server-only`, `withTenantContext`, no `withResolvedIdentityContext`, no direct `messages.create(`), and the `Chat` i18n namespace parity check.
- `git status --short` after each commit — clean, no unexpected untracked or deleted files.

## Substituted Verification (no live LLM call, no live Postgres)

Per this plan's own scope (04-12 is the phase's live checkpoint) and the fact that `DATABASE_URL`/`OPENROUTER_API_KEY` are not provisioned in this session (STATE.md's known blocker), this plan's verification is entirely structural (tsc/eslint/build/grep/node-script assertions on source), matching every prior plan in this wave that shares the same constraint. `sendWebChatTurn`'s actual behavior — inserting a real row under real RLS, a real `messages_web_chat_insert` check passing/failing correctly, a real `runTurn` round-trip — is unproven until 04-12 applies migration 0017 to Neon and runs the live checkpoint with real credentials.

## User Setup Required

None beyond what prior plans in this phase already documented (`DATABASE_URL`, `OPENROUTER_API_KEY`/`ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, Clerk/R2/Meta credentials) — this plan introduces no new environment variable. Migration 0017 is journalled but NOT applied to Neon; that is explicitly 04-12's job, alongside 0014-0016.

## Threat Flags

None — every file created or modified in this plan is exactly the surface the plan's own `<threat_model>` (T-04-47 through T-04-52) already covers: the new `/api/chat` endpoint, the Clerk-session write path to `messages`, the attachment size ceiling, and the transaction/LLM-call ordering. No new network endpoint, auth path, or schema change was introduced beyond what the plan specifies.

## Next Phase Readiness

`sendWebChatTurn` and `/dashboard/chat` are ready for 04-11 (bitácora) to surface web-channel rows alongside WhatsApp ones — no code change needed there since `messages_select_by_role` (migration 0015) is already channel-agnostic. 04-12 is the phase's live checkpoint: it must apply migration 0017 (alongside 0014-0016) to Neon and is the first place `messages_web_chat_insert`'s actual RLS behavior, and a real `POST /api/chat` round-trip against a live Anthropic/OpenRouter call, get proven end-to-end.

---
*Phase: 04-agente-conversacional-core*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 5 created files confirmed present on disk (`drizzle/migrations/0017_web_chat_messages.sql`,
`lib/agent/web-chat.ts`, `app/api/chat/route.ts`, `app/[locale]/dashboard/chat/page.tsx`,
`app/[locale]/dashboard/chat/chat-panel.tsx`), plus this SUMMARY.md. All three task commit
hashes (`eaffd42`, `80b554d`, `60d06ba`) confirmed present in `git log`.
