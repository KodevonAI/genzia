---
phase: 03-integraci-n-con-whatsapp-meta
plan: 05
subsystem: whatsapp-integration
tags: [drizzle, postgres-rls, security-definer, identity-resolution, idempotency, whatsapp]

# Dependency graph
requires:
  - phase: 03-integraci-n-con-whatsapp-meta (plan 01)
    provides: "messages table, messages_agency_id_meta_message_id_idx, find_agency_by_team_whatsapp_number SECURITY DEFINER function (migration 0013)"
  - phase: 03-integraci-n-con-whatsapp-meta (plan 02)
    provides: "withSystemWebhookContext (DEC-A system-actor scope), inngest/client.ts's WhatsAppMessageReceivedData contract"
  - phase: 03-integraci-n-con-whatsapp-meta (plan 03)
    provides: "ParsedInboundMessage / toMessageType (lib/whatsapp/parse-webhook-payload.ts)"
  - phase: 02-modelo-identidad-permisos (plan 04)
    provides: "resolveIdentity(agencyId, phoneNumber), ResolvedIdentity discriminated union"
provides:
  - "findAgencyByTeamWhatsAppNumber: thin wrapper over the SECURITY DEFINER cross-agency lookup, no direct team_members read"
  - "resolveInboundAgency: phone_number_id + sender -> {agency_number|shared_internal|no_agency} routing decision, fail-safe env map parser"
  - "ingestInboundMessage: agency routing -> identity resolution -> idempotent messages insert, in that fixed order, never inside a withResolvedIdentityContext scope"
affects: ["03-06 (Inngest consumer dispatches send-ack only on outcome: ingested)", "03-07 (route handler composes these three modules)", "03-08 (real-Neon proof that resolveInboundAgency/ingestInboundMessage behave correctly, and that the QueryResult unwrapping in findAgencyByTeamWhatsAppNumber matches the live driver shape)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Identity/tenant resolution completed and turned into plain data BEFORE any RLS-scoped write transaction opens — closes SEG-12 by construction rather than by code review, per 03-05-PLAN.md's architecture_decision"
    - "onConflictDoNothing + .returning() as the idempotency gate on a partial unique index, mirroring lib/agencies/create-agency.ts's at-least-once-delivery pattern"

key-files:
  created:
    - lib/whatsapp/find-agency-by-whatsapp-number.ts
    - lib/whatsapp/resolve-inbound-agency.ts
    - lib/whatsapp/ingest-inbound-message.ts
  modified: []

key-decisions:
  - "Followed the plan's architecture_decision exactly: agency-owned numbers route via META_AGENCY_PHONE_NUMBER_MAP; the shared internal number routes via the sender's registration through the SECURITY DEFINER function; anything else (or a shared-number sender registered nowhere) is no_agency and writes nothing"
  - "identityDb.execute()'s result is unwrapped defensively (Array.isArray(...) ? rows : rows.rows ?? []) per the plan's own note that drizzle-orm/neon-serverless's execute() returns a pg-style QueryResult, not a bare array — left exactly as specified since plan 03-08 is the one that proves the runtime shape against real Neon"

requirements-completed: [WA-02, WA-03, WA-04]

# Metrics
duration: 35min
completed: 2026-09-10
---

# Phase 3 Plan 05: Identity Resolution and Idempotent Message Ingestion Summary

**Closes RESEARCH.md's Critical Architecture Gap: `findAgencyByTeamWhatsAppNumber` + `resolveInboundAgency` determine which agency owns an inbound WhatsApp message (agency-owned number, shared internal number by sender registration, or no agency at all), and `ingestInboundMessage` applies Phase 2's `resolveIdentity` before writing exactly one idempotent row via `withSystemWebhookContext`.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-09-10
- **Tasks:** 2/2
- **Files modified:** 3 (all new)

## Accomplishments
- `lib/whatsapp/find-agency-by-whatsapp-number.ts` — calls only the `find_agency_by_team_whatsapp_number` SECURITY DEFINER function (migration 0013), never reads `team_members`/`authorized_contacts` directly, opens no second Postgres pool
- `lib/whatsapp/resolve-inbound-agency.ts` — distinguishes `agency_number` (env-mapped destination number), `shared_internal` (sender's own registration via the cross-agency lookup), and `no_agency` (unmapped destination, or a shared-number sender registered nowhere); a malformed `META_AGENCY_PHONE_NUMBER_MAP` degrades to an empty map with a `console.warn`, never throws
- `lib/whatsapp/ingest-inbound-message.ts` — the phase's success-criterion function: resolves agency, then identity (both complete BEFORE any write scope opens), then writes through `withSystemWebhookContext` with `onConflictDoNothing` on `(agency_id, meta_message_id)` for exactly-once persistence; returns `ingested | duplicate | no_agency` so the caller (plan 03-07) dispatches exactly one ack per genuinely-new message

## Task Commits

Each task was committed atomically:

1. **Task 1: Cross-agency lookup wrapper and inbound agency routing** - `42ab875` (feat)
2. **Task 2: Resolve identity and persist one inbound message idempotently** - `c174455` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `lib/whatsapp/find-agency-by-whatsapp-number.ts` - Thin wrapper over `find_agency_by_team_whatsapp_number`, defensive `QueryResult`/array unwrapping, no fallback table read
- `lib/whatsapp/resolve-inbound-agency.ts` - `InboundAgencyResolution` union, process-cached env map parser with `resetAgencyNumberMapCache()` test seam, routing logic per the plan's two-number-class design
- `lib/whatsapp/ingest-inbound-message.ts` - `IngestResult` union, `identityRowId`/`identityClientId` helpers, the fixed resolve-agency -> resolve-identity -> write ordering, idempotent insert via `withSystemWebhookContext`

## Decisions Made
- No re-litigation of the plan's architecture_decision or its exact code — implemented verbatim, including the doc comments explaining SEG-12, the ordering invariant, and the `.returning()` dependency on `messages_system_webhook_all` being `FOR ALL`.
- Used the plan's specified defensive unwrapping for `identityDb.execute()`'s result rather than assuming either the bare-array or `QueryResult` shape at type-check time, consistent with the plan's explicit note that plan 03-08's real-Neon run is what proves the shape.

## Deviations from Plan

None - plan executed exactly as written. All acceptance-criteria greps (SECURITY DEFINER-only lookup, no direct `team_members`/`authorized_contacts` reads, no second `Pool`, exact `no_agency` reason literals, single internal `throw` in the map parser, `withSystemWebhookContext`-only write path, resolve-agency-then-identity-then-write ordering, `onConflictDoNothing` targeting `[messages.agencyId, messages.metaMessageId]`, no `graph.facebook.com` reference) pass exactly as specified.

One environment note (not a code deviation): this worktree had no `node_modules` of its own (git worktrees don't carry untracked directories). Symlinked `node_modules` to the main checkout's install to run `tsc`/`eslint`/`tsx` — no package.json or lockfile change, nothing committed.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. This plan is code-only; the SECURITY DEFINER function and RLS policies it calls into were already written to migration 0013 in plan 03-01 and are not yet applied to any database (plan 03-08's blocking task).

## Next Phase Readiness
- `findAgencyByTeamWhatsAppNumber`, `resolveInboundAgency`, and `ingestInboundMessage` are stable import targets for plan 03-07's route handler (`app/api/webhooks/meta/route.ts`), which composes them with `inngest.send(...)` gated on `outcome === "ingested"`.
- Not yet functionally verified against real Neon — per this plan's own `<verification>` section, that is explicitly plan 03-08's job (`scripts/verify-whatsapp-webhook.ts`). Static verification (tsc, eslint, the no-network parsing script, and every acceptance-criteria grep) is complete and green.
- No blockers for the rest of Wave 2 or Wave 3.

---
*Phase: 03-integraci-n-con-whatsapp-meta*
*Completed: 2026-09-10*

## Self-Check: PASSED

- FOUND: lib/whatsapp/find-agency-by-whatsapp-number.ts
- FOUND: lib/whatsapp/resolve-inbound-agency.ts
- FOUND: lib/whatsapp/ingest-inbound-message.ts
- FOUND commit: 42ab875
- FOUND commit: c174455
