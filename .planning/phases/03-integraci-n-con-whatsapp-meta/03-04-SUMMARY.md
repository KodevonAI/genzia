---
phase: 03-integraci-n-con-whatsapp-meta
plan: 04
subsystem: api
tags: [whatsapp, meta, graph-api, fetch]

requires:
  - phase: 03-integraci-n-con-whatsapp-meta
    provides: "plan 03-02's .env.example documentation of META_WHATSAPP_PHONE_NUMBER_ID / META_WHATSAPP_ACCESS_TOKEN"
provides:
  - "sendWhatsAppTextMessage(toPhoneNumber, body) — direct Graph API v25.0 outbound text send, no SDK/BSP"
  - "scripts/verify-whatsapp-send.ts — offline, no-network proof of the exact outbound request shape"
affects: [03-06, 03-07, 03-08]

tech-stack:
  added: []
  patterns:
    - "requiredEnv() guard convention (from lib/storage/r2-client.ts / lib/db/index.ts) reused for Meta credentials"
    - "Stubbed globalThis.fetch reassignment (no mocking library) for offline request-shape assertions"

key-files:
  created:
    - lib/whatsapp/send-message.ts
    - scripts/verify-whatsapp-send.ts
  modified: []

key-decisions:
  - "No retry logic in send-message.ts — retry/backoff is Inngest's step.run responsibility (plan 03-06), avoiding a compounding double-retry"
  - "No import \"server-only\" on send-message.ts, so the offline verify script can import it directly under tsx"

patterns-established:
  - "Pattern: direct fetch to Meta Graph API instead of an SDK wrapper, matching STACK-AGENT.md's stated preference against abstraction layers over 3-line calls"

requirements-completed: [WA-01]

duration: ~15min
completed: 2026-09-10
---

# Phase 03: Integración con WhatsApp/Meta Summary — Plan 04

**Direct Meta Graph API v25.0 outbound text send with offline-provable request shape (12/12 assertions), no SDK, no hand-rolled retry**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2/2
- **Files modified:** 2 (both new)

## Accomplishments
- `sendWhatsAppTextMessage` posts one `fetch` to `https://graph.facebook.com/v25.0/{phone_number_id}/messages` with the exact documented body shape, returns Meta's `wamid`, and throws with upstream status+body on failure (never the access token)
- `scripts/verify-whatsapp-send.ts` proves the entire request/response contract (URL, method, headers, body, error surfacing, credential guards, token-leak prevention) against a stubbed `fetch`, zero network/DB dependency

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement the direct Graph API text send** — `26f7a2d` (feat)
2. **Task 2: Prove the outgoing request shape against a stubbed fetch** — `f2b102b` (test)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified
- `lib/whatsapp/send-message.ts` — `sendWhatsAppTextMessage()` + `GRAPH_API_VERSION` export; direct Graph API v25.0 send
- `scripts/verify-whatsapp-send.ts` — 12-assertion offline proof of the outbound request shape

## Decisions Made
- Followed plan exactly: no retry loop (reserved for Inngest in plan 03-06), no `import "server-only"` (documented in the file's own header comment — required so the tsx-run verify script can import the module directly)

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None. This plan's own execution hit an unrelated infrastructure rate-limit mid-run (after both task commits landed, before SUMMARY.md); this SUMMARY.md and its commit close that out — all code, verification, and assertions were already complete and green at that point, re-confirmed by re-running `npx tsc --noEmit`, `npx eslint lib/whatsapp/send-message.ts`, and `npx tsx scripts/verify-whatsapp-send.ts` (12/12 PASS, 0 FAIL) before writing this file.

## User Setup Required

None beyond what plan 03-02 already documents in `.env.example` (`META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_ACCESS_TOKEN`) — no new external service configuration in this plan.

## Next Phase Readiness
- Plan 03-06 (Inngest ack function) can now call `sendWhatsAppTextMessage` directly
- Plan 03-08's real end-to-end checkpoint will exercise this against the live Meta test WABA

---
*Phase: 03-integraci-n-con-whatsapp-meta*
*Completed: 2026-09-10*
