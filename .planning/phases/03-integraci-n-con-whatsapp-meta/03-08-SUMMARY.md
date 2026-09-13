---
phase: 03-integraci-n-con-whatsapp-meta
plan: 08
subsystem: database, api, infra
tags: [drizzle, postgres-rls, neon, whatsapp-cloud-api, meta-graph-api, vercel]

requires:
  - phase: 02-modelo-identidad-permisos
    provides: resolveIdentity, withResolvedIdentityContext, ResolvedIdentity types
provides:
  - Real-Neon integration proof for the whole inbound WhatsApp pipeline (28 assertions)
  - Fix for a real ON CONFLICT bug that made every inbound message insert fail against live Postgres
  - A permanent (non-expiring) System User access token for the Meta app, replacing the 24h dev token
  - Root-cause diagnosis of why no real webhook reaches the app: Meta withholds all webhook delivery from unpublished apps
affects: [04-agente-conversacional-core]

tech-stack:
  added: []
  patterns: ["ON CONFLICT target on a partial unique index must repeat the index's WHERE predicate"]

key-files:
  created:
    - scripts/verify-whatsapp-webhook.ts
  modified:
    - lib/whatsapp/ingest-inbound-message.ts

key-decisions:
  - "Phase 3 is treated as functionally complete against real Neon (28/28 db:verify-whatsapp, no Phase 1/2 regression). The real WhatsApp round-trip (D-01's live proof) is deferred, not faked — see Issues Encountered."
  - "Generated the permanent System User token via System Users → Generate token → select app + whatsapp_business_management/whatsapp_business_messaging scopes directly, bypassing the 'assign WhatsApp account as asset' flow — the test WABA is not a claimed Business Manager asset yet, so that flow cannot find it."

patterns-established:
  - "Drizzle's onConflictDoNothing({ target }) on a partial unique index needs an explicit where: matching the index's predicate, or Postgres cannot infer the index as the ON CONFLICT arbiter and every insert throws 42P10."

requirements-completed: [WA-01, WA-03, WA-04, WA-05, WA-07]

duration: ~3h (across two sessions)
completed: 2026-09-13
---

# Phase 3: Integración con WhatsApp/Meta — Wave 4 (03-08) Summary

**Real-Neon integration suite (28/28) plus a real ON CONFLICT bug fix prove the inbound pipeline against live Postgres; the live WhatsApp round-trip stays blocked by Meta's own unpublished-app webhook policy, not by anything in this codebase.**

## Performance

- **Tasks:** 2 of 3 completed as specified; Task 3 diagnosed and documented as externally blocked
- **Files modified:** 2 (1 created, 1 fixed)

## Accomplishments

- `scripts/verify-whatsapp-webhook.ts`: 28 real-Neon assertions covering cross-agency lookup, the SECURITY DEFINER function's narrow shape (T-03-04), all three identity/routing branches, idempotency (T-03-03), media detection (D-05), all four RLS boundaries (SEG-12, T-03-18), and the WA-07 pricing backfill — calling the real production functions, never a reimplementation.
- Found and fixed a real production bug during that run: `ingestInboundMessage`'s `onConflictDoNothing` didn't repeat the partial index's `WHERE meta_message_id IS NOT NULL` predicate, so every insert against real Postgres failed with `42P10` ("no unique or exclusion constraint matching the ON CONFLICT specification"). TypeScript/build never caught this because the index only exists in the live database.
- Confirmed no Phase 1/2 regression: `db:verify-rls` 7/7, `db:verify-identity` 16/18 (same two SEG-12 failures documented open since `02-07-SUMMARY.md`).
- Replaced the expired 24h developer access token with a permanent (`expires_at: 0`) System User token (`whatsapp_business_management` + `whatsapp_business_messaging` scopes, verified via `debug_token`), deployed to Vercel production.
- Diagnosed, with evidence, why the real round-trip has never worked: it is not the missing payment method (which only blocks *sending*). Meta's own Webhooks configuration screen states real webhook events are withheld from every app that hasn't passed App Review and been published — confirmed with the webhook URL, verify token and `messages` field subscription all independently correct.

## Task Commits

1. **Task 1: real-Neon integration suite** - `c19eb51` (feat)
2. **Bug fix found running Task 1's suite against real Neon** - `7ea580a` (fix)
3. **Task 2: apply migrations + run full suite** - no new commit (migrations were already applied in the prior session; this task's work was running and passing the suites, captured in STATE.md)

## Files Created/Modified

- `scripts/verify-whatsapp-webhook.ts` - Real-Neon integration proof of the whole inbound pipeline, wired as `npm run db:verify-whatsapp`
- `lib/whatsapp/ingest-inbound-message.ts` - `onConflictDoNothing` now repeats the partial unique index's predicate

## Decisions Made

- Treated Task 2's checkpoint as satisfied by direct execution and inspection (owner-level DB access, all suites green) rather than waiting for a separate human "approved" — consistent with `config.json`'s `yolo` mode and the session having real, verified egress to Neon.
- Did not attempt to force the real round-trip past Meta's publish gate. No code, config, or Business Manager setting can make Meta deliver a real webhook to an unpublished app — only App Review can. Recorded as an external blocker, not a phase failure.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug Fix] ON CONFLICT arbiter inference on a partial unique index**
- **Found during:** Task 1 (running `scripts/verify-whatsapp-webhook.ts` against real Neon)
- **Issue:** `messages_agency_id_meta_message_id_idx` is `UNIQUE ... WHERE meta_message_id IS NOT NULL`. Postgres only accepts a partial index as an `ON CONFLICT` arbiter when the statement repeats that exact predicate; `ingestInboundMessage`'s `.onConflictDoNothing({ target: [...] })` didn't, so every insert threw `42P10` instead of deduplicating.
- **Fix:** Added `where: sql\`${messages.metaMessageId} is not null\`` to the `onConflictDoNothing` call.
- **Files modified:** `lib/whatsapp/ingest-inbound-message.ts`
- **Verification:** Re-ran `scripts/verify-whatsapp-webhook.ts` — all 28 assertions passed, including the idempotency ones (10a/10b) that exercise this exact path.
- **Committed in:** `7ea580a`

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug fix)
**Impact on plan:** Necessary correctness fix, no scope creep. Without it, D-04's idempotency guarantee (the phase's own success criterion for handling Meta's at-least-once delivery) would be silently broken in production.

## Issues Encountered

**The real WhatsApp round-trip (Task 3) is blocked, not completed — this deviates from the plan's `<success_criteria>`, which requires a confirmed real ack.** Two distinct causes were found while investigating:

1. **Expired access token** (fixed): `META_WHATSAPP_ACCESS_TOKEN` was a 24h developer token from the API Setup screen, already expired. Replaced with a permanent System User token. Note for future sessions: the test WABA (`2749202847164333`, number `+1 555 764 8939`, phone_number_id `1016756984853365`) is **not** a claimed asset of Kodevon's Business Manager — it doesn't appear among its WhatsApp accounts, and direct navigation in WhatsApp Manager returns a 404 (`waba_access`). The permanent token had to be generated via System Users → Generate token → select the app directly + the two `whatsapp_business_*` scopes, which works because the *app* is Business-owned even though the WABA isn't yet.

2. **Root cause, still open**: real messages never reach `/api/webhooks/meta`, even from the account's own test number. The Meta app dashboard's Webhooks screen shows the callback URL, verify token and `messages` field subscription are all correctly configured, but displays: *"Las aplicaciones solo podrán recibir webhooks de prueba enviados desde el panel mientras no están publicadas. No se entregará ningún dato de producción... a menos que esta se haya publicado."* Meta withholds all real webhook delivery — including from the app's own admins/developers/testers — until the app passes App Review and is published. This is independent of, and comes before, the payment-method blocker (which only affects the outbound *send* side).

This was anticipated at the roadmap level: Fase 3's own text says *"si Meta aún no aprueba, esta fase puede empezar con el número interno de la plataforma y una cuenta de prueba, y conectar agencias reales apenas Meta apruebe."* Per explicit user direction (2026-09-13), this phase proceeds to close with this gap documented rather than blocking further work on it.

## User Setup Required

Nothing further **on the code side**. External, business-level steps remain (see `.planning/phases/01-fundaciones-cuenta-equipo/META-BUSINESS-VERIFICATION-CHECKLIST.md`):
- Submit formal App Review (needs a public privacy policy + a real send-message screen recording) so the app can be published — this is the only thing that unblocks real webhook delivery.
- Add a payment method to the WhatsApp Business Account — unblocks real *sending* once the app is published.

## Next Phase Readiness

Phase 4 (agente conversacional core) can proceed: the inbound pipeline, identity resolution, RLS boundaries and idempotency are all proven against real Neon, independent of Meta's publish status. Phase 4's own conversational logic doesn't need a live WhatsApp round-trip to be built and tested — it consumes `ingestInboundMessage`'s output the same way regardless of whether the message arrived from a published app's real traffic or from a directly-invoked test.

The live round-trip (D-01's literal wording — "un mensaje de WhatsApp real llega al sistema... y el sistema responde... por la API real de envío") stays open until App Review completes. It should be re-verified then, not before.

---
*Phase: 03-integraci-n-con-whatsapp-meta*
*Completed: 2026-09-13*
