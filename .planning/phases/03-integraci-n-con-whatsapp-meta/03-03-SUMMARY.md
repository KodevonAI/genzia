---
phase: 03-integraci-n-con-whatsapp-meta
plan: 03
subsystem: api
tags: [whatsapp, meta, webhook, hmac, crypto]

requires: []
provides:
  - "verifyMetaWebhookSignature() — constant-time HMAC-SHA256 verification of the raw webhook body"
  - "parseMetaWebhookPayload() — throw-free typed parser for text/image/audio/unsupported/status webhook changes"
affects: [03-07, 03-08]

tech-stack:
  added: []
  patterns:
    - "timingSafeEqual (node:crypto) for all secret comparisons, never ===, to avoid timing side-channels"
    - "Throw-free parser returning empty results on malformed input, never crashing the caller"

key-files:
  created:
    - lib/webhooks/verify-meta-signature.ts
    - lib/whatsapp/parse-webhook-payload.ts
    - scripts/verify-whatsapp-webhook-parsing.ts
  modified: []

key-decisions:
  - "No import \"server-only\" on verify-meta-signature.ts (Rule 1 auto-fix, see Deviations) — same reasoning already used in lib/tenant/with-resolved-identity-context.ts"

patterns-established:
  - "Meta phone numbers arrive without a leading +; parser normalizes to E.164 (+<digits>) at the boundary so every downstream consumer sees a consistent format"

requirements-completed: [WA-05]

duration: ~20min (across an interrupted session)
completed: 2026-09-10
---

# Phase 03: Integración con WhatsApp/Meta Summary — Plan 03

**Constant-time HMAC-SHA256 webhook signature verification plus a throw-free Meta payload parser, proven offline by 19/19 passing assertions**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2/2
- **Files modified:** 3 (all new)

## Accomplishments
- `verifyMetaWebhookSignature` rejects missing/malformed/tampered/short `X-Hub-Signature-256` headers using `timingSafeEqual`, never a length- or content-leaking `===`
- `parseMetaWebhookPayload` typed-parses text/image/audio/video(unsupported)/status webhook changes, normalizes Meta's non-`+`-prefixed numbers to E.164, and never throws on malformed input
- `scripts/verify-whatsapp-webhook-parsing.ts` proves both modules offline with 19 assertions (0 network, 0 DB)

## Task Commits

Each task was committed atomically:

1. **Task 1: Build HMAC signature verification and the typed payload parser** — `a44cf35` (feat)
2. **Task 2: Prove signature verification and payload parsing offline** — `3186611` (test, includes the Task 1 deviation fix below)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified
- `lib/webhooks/verify-meta-signature.ts` — `verifyMetaWebhookSignature()`, `MetaWebhookVerificationError`
- `lib/whatsapp/parse-webhook-payload.ts` — `parseMetaWebhookPayload()`, `ParsedInboundMessage`, `ParsedStatusUpdate`, `ParsedWebhookChange`, `toMessageType`
- `scripts/verify-whatsapp-webhook-parsing.ts` — 19-assertion no-network suite

## Decisions Made
None beyond the plan's own design (D-05 media-detection-only scope, E.164 normalization at the parser boundary) — both already specified in the plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug fix] Removed `import "server-only"` from `lib/webhooks/verify-meta-signature.ts`**
- **Found during:** Task 2 (writing/running the no-network verification script)
- **Issue:** The plan's Task 1 action literally included `import "server-only"` at the top of the file. `server-only` resolves to its throwing entrypoint under plain `tsx` (it only no-ops under Next.js's `react-server` bundler condition), so `scripts/verify-whatsapp-webhook-parsing.ts` crashed on import before a single assertion could run — a direct conflict between Task 1's literal code and Task 2's own required verification command.
- **Fix:** Removed the import, added a doc-comment explaining why, mirroring the exact same already-established pattern in `lib/tenant/with-resolved-identity-context.ts` (which omits `server-only` for the identical reason: its own `scripts/verify-*.ts` needs to import it under `tsx`). The module remains callable only from `app/api/webhooks/meta/route.ts` (a server-only Route Handler) — this only removes the marker package's build-time guard, it does not open a new client-bundling path.
- **Files modified:** `lib/webhooks/verify-meta-signature.ts`
- **Verification:** `npx tsx scripts/verify-whatsapp-webhook-parsing.ts` — 19/19 `[PASS]`, 0 `[FAIL]`; `npx tsc --noEmit` and `npx eslint` both clean
- **Committed in:** `3186611` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix, blocking)
**Impact on plan:** Necessary for correctness — the plan as literally written was self-contradictory (Task 1's `server-only` import vs. Task 2's `tsx`-based verification requirement). No scope creep; the fix is a one-line removal plus a documenting comment, following an existing in-repo precedent exactly.

## Issues Encountered

This plan's execution was interrupted by an unrelated infrastructure rate-limit partway through applying the Task 2 fix (Task 1 already committed, the fix and the new script already written but uncommitted). This SUMMARY.md and the accompanying commit close that out — the fix and the verification script were re-confirmed green (`npx tsc --noEmit`, `npx eslint`, and the 19-assertion script all passing) before committing.

## User Setup Required

None. `META_APP_SECRET` is already documented in `.env.example` by plan 03-02.

## Next Phase Readiness
- Plan 03-07 (webhook route handler) can now import both `verifyMetaWebhookSignature` and `parseMetaWebhookPayload` directly
- Plan 03-08's real-Neon integration suite can reuse the same fixtures for live-payload assertions

---
*Phase: 03-integraci-n-con-whatsapp-meta*
*Completed: 2026-09-10*
