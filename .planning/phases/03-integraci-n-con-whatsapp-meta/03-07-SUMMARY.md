---
phase: 03-integraci-n-con-whatsapp-meta
plan: 07
subsystem: api
tags: [webhook, whatsapp, meta, hmac, inngest, next-route-handler, rls]

# Dependency graph
requires:
  - phase: 03-integraci-n-con-whatsapp-meta (plan 03)
    provides: "verifyMetaWebhookSignature, parseMetaWebhookPayload, ParsedStatusUpdate"
  - phase: 03-integraci-n-con-whatsapp-meta (plan 05)
    provides: "resolveInboundAgency, ingestInboundMessage, IngestResult union"
  - phase: 03-integraci-n-con-whatsapp-meta (plan 06)
    provides: "inngest/client.ts's inngest singleton and whatsapp/message.received event contract, app/api/inngest/route.ts"
provides:
  - "recordDeliveryStatus() — WA-07 delivery status + pricing backfill onto the matching outbound row, scoped by (agencyId, metaMessageId) under withSystemWebhookContext"
  - "app/api/webhooks/meta/route.ts — the phase's one HTTP surface: GET handshake + POST intake composing every prior plan's module into a single thin orchestrator"
affects: ["03-08 (real-Neon + real-Meta end-to-end verification of this exact route)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Route handler stays a thin orchestrator — no tx.insert, no drizzle sql template, no direct data-layer code; all writes delegated to lib/whatsapp/*"
    - "Per-item try/catch inside the messages/statuses loops so one poison payload item cannot abort the whole batch; 500 only when every item in the batch failed"

key-files:
  created:
    - lib/whatsapp/record-delivery-status.ts
    - app/api/webhooks/meta/route.ts
  modified: []

key-decisions:
  - "Followed the plan's action code verbatim for both files — both already matched the actually-installed APIs (inngest.send({name,data}) object-literal form is the SDK's own documented example; resolveInboundAgency/ingestInboundMessage/inngest client signatures from prior waves required no adaptation)"
  - "Replaced the symlinked node_modules (used successfully for tsc/eslint/tsx in prior waves) with a real npm install for this plan, because Turbopack's next build panics on a symlink target outside the worktree's own directory tree ('Symlink [project]/node_modules is invalid, it points out of the filesystem root') — npm install produced an identical lockfile (no diff), so nothing was staged for this change"

requirements-completed: [WA-01, WA-03, WA-05, WA-07]

# Metrics
duration: ~45min
completed: 2026-09-10
---

# Phase 3 Plan 07: Meta Webhook Route Handler + Delivery-Status Backfill Summary

**Composes every Phase 3 module into one HTTP surface — `app/api/webhooks/meta/route.ts` handles Meta's GET verification handshake and POST event delivery (signature-verify-then-parse, idempotent ingest, ack dispatch gated on new-insert-only), and the new `recordDeliveryStatus()` backfills Meta's own delivery status and pricing facts (WA-07) onto the matching outbound row.**

## Performance

- **Duration:** ~45 min (includes worktree base correction, full context read, and an environment fix for `next build`)
- **Tasks:** 2/2
- **Files modified:** 2 (both new)

## Accomplishments
- `recordDeliveryStatus()` routes a `statuses[]` receipt through the same `resolveInboundAgency` used for inbound messages, then updates the matching `messages` row (`WHERE agency_id = ... AND meta_message_id = ...`) under `withSystemWebhookContext`, writing `deliveryStatus` always and `conversationId`/`pricingCategory`/`pricingBillable` only when Meta actually sent them (never nulling a prior `delivered` receipt's pricing with a later `sent` receipt's empty pricing block)
- `app/api/webhooks/meta/route.ts` is the phase's single HTTP surface:
  - `GET` echoes the bare `hub.challenge` string (no JSON wrapper) only when `hub.mode === "subscribe"` and the verify token matches, else 403
  - `POST` reads the raw body, verifies `X-Hub-Signature-256` before any `JSON.parse` or database call, rejects with 400 on failure
  - Each inbound message is ingested via `ingestInboundMessage`; the `whatsapp/message.received` event is dispatched (awaited) only when `outcome === "ingested"`, so a replayed duplicate delivery produces zero extra acks
  - Each status receipt is recorded via `recordDeliveryStatus`
  - Both loops wrap each item in its own try/catch; the batch returns 500 only when `failed > 0 && processed === 0` (every item failed), and 200 whenever at least one item succeeded — matching Meta's at-least-once retry semantics
- `npx next build` lists `/api/webhooks/meta` as a registered dynamic route with zero errors referencing either new file

## Task Commits

Each task was committed atomically:

1. **Task 1: Record Meta delivery status and pricing on the outbound row (WA-07)** — `3d3accf` (feat)
2. **Task 2: Implement the Meta webhook route handler (GET handshake + POST intake)** — `1f07288` (feat)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified
- `lib/whatsapp/record-delivery-status.ts` — `recordDeliveryStatus()`, `RecordDeliveryStatusResult` (`"updated" | "no_match" | "no_agency"`)
- `app/api/webhooks/meta/route.ts` — `GET`, `POST`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`

## Decisions Made
- Implemented both files exactly as the plan's `<action>` blocks specified — no code-level deviation was needed. Unlike plans 03-02/03-06 in this same phase, this plan's literal code samples already matched the actually-installed `inngest@4.20.0` API (`inngest.send({ name, data })` is that SDK's own documented example, confirmed directly against `node_modules/inngest/components/Inngest.d.ts`) and the actual signatures of `resolveInboundAgency`/`ingestInboundMessage`/`recordDeliveryStatus`'s own dependencies from prior waves.
- Environment-only fix (not a code deviation): replaced the worktree's symlinked `node_modules` with a real `npm install` before running `next build`, because Turbopack refuses to resolve `next` through a symlink whose target lies outside the worktree's own directory subtree (a `TurbopackInternalError: Symlink [project]/node_modules is invalid, it points out of the filesystem root`). `tsc`/`eslint`/`tsx` all worked fine through the symlink (as in prior waves); only Turbopack's build-time package resolution rejected it. `npm install` produced a byte-identical `package-lock.json` (confirmed via `git status --short`), so nothing was staged or committed for this.

## Deviations from Plan

None (code) — plan executed exactly as written for both tasks. All acceptance-criteria greps pass except one plan-authoring artifact, documented below (not a functional gap, no fix required or made).

**Known plan-authoring artifact (not a deviation, no action needed):** The plan's own acceptance criterion `grep -q 'Response.json' app/api/webhooks/meta/route.ts` (exits NON-zero) fails as literally stated, because the plan's own `<action>` code block — copied verbatim — contains the string `Response.json` twice inside doc comments explaining *why not* to use it (`"Returning Response.json(...) or any wrapper is the single most common integration failure..."` and `"// Plain text, NOT Response.json()."`). The actual code contains zero `Response.json(...)` calls; the GET handler returns `new Response(challenge ?? "", { status: 200 })` exactly as required. This is the same category of grep-vs-literal-plan-text artifact already documented in `03-02-SUMMARY.md` and `03-06-SUMMARY.md` for this phase — confirmed by grepping the plan file itself (`03-07-PLAN.md` lines 348/359/487 all contain the same string). No functional gap; removing the explanatory comments to satisfy a literal grep would reduce code quality for no benefit, so the comments were kept.

## Issues Encountered
- `next build` panicked under Turbopack when `node_modules` was a symlink pointing to the main checkout (works fine for `tsc`/`eslint`/`tsx`, fails specifically for Turbopack's own package resolution) — resolved by running a real `npm install` in the worktree instead (see Decisions Made above).
- This worktree had no `.env`/`.env.local` at start; copied both (gitignored, unstaged, unmodified) from the main checkout purely so `next build` could resolve `DATABASE_URL` etc. for an unrelated page during the build — same pattern already documented in `03-06-SUMMARY.md`.

## User Setup Required

None for this plan's own execution. Live behavior (Meta's real handshake succeeding, a real inbound message triggering a real ack, real `statuses[]` receipts populating pricing) is proven by the manual checkpoint in plan `03-08`, which needs the real Meta credentials already flagged as outstanding by `03-02-SUMMARY.md`.

## Next Phase Readiness
- `app/api/webhooks/meta/route.ts` and `lib/whatsapp/record-delivery-status.ts` are the final pieces of this phase's application code — every module built across waves 1-3 (`03-01` through `03-07`) is now composed into one HTTP surface
- Not yet functionally verified against real Neon or real Meta credentials — per this plan's own `<verification>` section, that is explicitly plan `03-08`'s job (migration 0012/0013 application to Neon + `db:verify-whatsapp` + a real manual WhatsApp round-trip)
- No blockers for `03-08`

---
*Phase: 03-integraci-n-con-whatsapp-meta*
*Completed: 2026-09-10*

## Self-Check: PASSED

- FOUND: lib/whatsapp/record-delivery-status.ts
- FOUND: app/api/webhooks/meta/route.ts
- FOUND commit: 3d3accf
- FOUND commit: 1f07288
