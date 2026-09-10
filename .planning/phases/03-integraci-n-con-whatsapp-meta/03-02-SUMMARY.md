---
phase: 03-integraci-n-con-whatsapp-meta
plan: 02
subsystem: infra
tags: [inngest, meta-whatsapp-cloud-api, postgres-rls, drizzle, next-intl, server-actions]

# Dependency graph
requires:
  - phase: 03-integraci-n-con-whatsapp-meta (plan 01)
    provides: "messages table, RLS policies (messages_system_webhook_all, messages_select_by_role), find_agency_by_team_whatsapp_number, team_members_whatsapp_number_global_idx"
provides:
  - "Meta/WhatsApp Cloud API env var documentation in .env.example (5 vars, no values)"
  - "inngest@4.20.0 installed + npm scripts wired for plans 03-03/03-04/03-08"
  - "inngest/client.ts: typed Inngest client + whatsapp/message.received event contract (binding for plans 03-05, 03-06)"
  - "lib/tenant/with-system-webhook-context.ts: the system-actor transaction scope (DEC-A) used by the webhook pipeline"
  - "whatsapp_taken invite error path (DEC-B), translated in es/en"
affects: [03-03, 03-04, 03-05, 03-06, 03-07, 03-08]

# Tech tracking
tech-stack:
  added: ["inngest@4.20.0"]
  patterns:
    - "Third tenant scope (withSystemWebhookContext) alongside withTenantContext and withResolvedIdentityContext, all sharing identityDb's single Postgres pool"
    - "Inngest typed events via eventType()/staticSchema() (this SDK version's replacement for EventSchemas/.fromRecord())"
    - "Postgres unique-violation-by-index-name mapped to a structured Server Action error result, not thrown"

key-files:
  created:
    - inngest/client.ts
    - lib/tenant/with-system-webhook-context.ts
  modified:
    - .env.example
    - package.json
    - package-lock.json
    - lib/team/invite-member.ts
    - app/[locale]/dashboard/team/invite-form.tsx
    - messages/es.json
    - messages/en.json

key-decisions:
  - "inngest@4.20.0 has no EventSchemas/.fromRecord() client-level typed-events API (present in the RESEARCH.md code sample from an older SDK version); substituted the installed version's actual API, eventType(name, { schema }) + staticSchema<T>(), which yields the same compile-time-only contract"
  - "withSystemWebhookContext reuses identityDb (no third Postgres pool) and omits `import \"server-only\"` so scripts/verify-whatsapp-webhook.ts (plan 03-08) can import it under plain tsx"
  - "isGlobalWhatsappCollision() matches the unique index NAME, not just SQLSTATE 23505, so the unrelated (agency_id, email) unique violation is never mislabelled as whatsapp_taken"

patterns-established:
  - "Pattern: Inngest typed events in this SDK version use eventType()/staticSchema(), not EventSchemas/.fromRecord() — apply this to any future Inngest event definitions in this repo"
  - "Pattern: a structured Postgres constraint-violation result (message string match on index name) beats a generic thrown 23505 for any future partial/global unique index added under a Server Action"

requirements-completed: [WA-01, WA-03]

# Metrics
duration: 77min
completed: 2026-09-10
---

# Phase 3 Plan 2: Shared Contracts and Credentials Summary

**Documented all five Meta/WhatsApp env vars, installed and typed Inngest with the `whatsapp/message.received` event contract, added the DEC-A system-actor transaction scope, and closed the DEC-B cross-agency WhatsApp-number invite collision with a translated error.**

## Performance

- **Duration:** 77 min (13:34–14:51 UTC-05:00, includes an infra rate-limit interruption and resume)
- **Started:** 2026-09-10T13:34:15-05:00
- **Completed:** 2026-09-10T14:51:25-05:00
- **Tasks:** 4/4
- **Files modified:** 9

## Accomplishments
- `.env.example` documents `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_ACCESS_TOKEN`, `META_AGENCY_PHONE_NUMBER_MAP`, each with its exact Meta dashboard path, no values committed
- `inngest@4.20.0` installed; `verify:whatsapp-parsing`, `verify:whatsapp-send`, `db:verify-whatsapp` npm scripts wired for plans 03-03/03-04/03-08
- `inngest/client.ts` exports the `inngest` singleton and the seven-field `WhatsAppMessageReceivedData` contract for `whatsapp/message.received` — the binding interface plans 03-05 (send) and 03-06 (consume) depend on
- `lib/tenant/with-system-webhook-context.ts` gives the Meta webhook pipeline a transaction scope that sets exactly `app.agency_id` and `app.actor = 'system_webhook'`, satisfying migration 0013's `messages_system_webhook_all` policy without ever opening an `unknown` identity scope (SEG-12)
- Inviting a team member whose WhatsApp number is already registered to another agency now returns `{ ok: false, error: "whatsapp_taken" }` and renders a translated message in both locales, instead of an unhandled Postgres `23505`

## Task Commits

Each task was committed atomically:

1. **Task 1: Document Meta credentials in .env.example and install Inngest** - `2474368` (feat)
2. **Task 2: Create the typed Inngest client and the whatsapp/message.received event contract** - `c8045be` (feat)
3. **Task 3: Create withSystemWebhookContext (DEC-A's system-actor transaction scope)** - `6d89984` (feat)
4. **Task 4: Handle the global WhatsApp unique-index violation at invite time** - `517d009` (feat)

**Plan metadata:** (this commit, to follow)

## Files Created/Modified
- `.env.example` - Meta/WhatsApp Cloud API credential documentation, five empty vars with dashboard sourcing comments
- `package.json` / `package-lock.json` - `inngest@4.20.0` dependency, three verification npm scripts
- `inngest/client.ts` - Typed Inngest client (`inngest`), `WhatsAppMessageReceivedData` event payload type, `whatsappMessageReceivedEvent` typed trigger
- `lib/tenant/with-system-webhook-context.ts` - `withSystemWebhookContext()`: sets `app.agency_id` + `app.actor`, reuses `identityDb`
- `lib/team/invite-member.ts` - `whatsapp_taken` error branch, `isGlobalWhatsappCollision()` helper, try/catch around the `teamMembers` insert
- `app/[locale]/dashboard/team/invite-form.tsx` - `whatsapp_taken` entry in `ERROR_KEYS`
- `messages/es.json`, `messages/en.json` - `Team.errors.whatsappTaken` translations

## Decisions Made
- Substituted `inngest@4.20.0`'s actual `eventType()`/`staticSchema()` API for RESEARCH.md's `EventSchemas`/`.fromRecord()` sample, which does not exist in the installed package version (see Deviations below)
- Kept the `try`/`catch` in `inviteMember` scoped to only the `tx.insert(teamMembers)` call, per plan, so an unrelated failure elsewhere in the transaction is not mislabelled as `whatsapp_taken`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/blocking, library API mismatch] `EventSchemas`/`.fromRecord()` does not exist in the installed Inngest version**
- **Found during:** Task 2 (typed Inngest client)
- **Issue:** RESEARCH.md's code sample specified `import { EventSchemas, Inngest } from "inngest"` and `new Inngest({ id, schemas: new EventSchemas().fromRecord<Events>() })`. This is an older (v3-era) client-level typed-events API. `inngest@4.20.0`, the version installed in Task 1 per RESEARCH.md's own npm-registry check, does not export `EventSchemas` and `ClientOptions` has no `schemas` field (verified directly against `node_modules/inngest/index.d.ts`). Using the sample as written would fail to compile.
- **Fix:** Used the installed version's actual per-event typed-events API instead: `eventType("whatsapp/message.received", { schema: staticSchema<WhatsAppMessageReceivedData>() })` (documented in `node_modules/inngest/components/triggers/triggers.d.ts` as "the primary way to define typed events" in this SDK version), exported as `whatsappMessageReceivedEvent`. `new Inngest({ id: "genzia" })` no longer takes a `schemas` option. `staticSchema<T>()` is compile-time-only with no runtime validation, matching this repo's existing no-schema-validation-dependency posture (RESEARCH.md §Alternatives Considered). The binding contract required by plans 03-05/03-06 — the `WhatsAppMessageReceivedData` shape and the `"whatsapp/message.received"` event name — is unchanged.
- **Files modified:** `inngest/client.ts`
- **Verification:** `npx tsc --noEmit` exits 0; all Task 2 acceptance-criteria greps pass (`new Inngest({`, `"genzia"`, `"whatsapp/message.received"`, exports of both `inngest` and `WhatsAppMessageReceivedData`, exactly the seven specified fields)
- **Committed in:** `c8045be` (Task 2 commit, with the deviation documented in the commit body)

---

**Total deviations:** 1 auto-fixed (1 blocking/library-API-mismatch)
**Impact on plan:** Necessary for the code to compile against the actually-installed dependency version. The binding event contract (name, payload shape, exports) required by downstream plans 03-05 and 03-06 is unchanged. No scope creep.

## Issues Encountered
- Execution of this plan was interrupted mid-Task-2 by an infrastructure rate-limit (not a plan or code failure) in a prior session. Resumed in the same worktree: Task 1's commit and Task 2's already-written, tsc-clean `inngest/client.ts` were verified against the plan's acceptance criteria before being committed; Tasks 3 and 4 were then executed fresh.
- Minor plan/acceptance-criteria note (not a deviation, no action taken): Task 3's acceptance criteria state `grep -c "set_config" lib/tenant/with-system-webhook-context.ts` should return 2, but the file's own doc comment (verbatim from the plan's literal specified content) also contains the substring `set_config` once, making the actual grep count 3. The code itself sets exactly two GUCs at runtime (`app.agency_id`, `app.actor`), which is what matters functionally; the plan's `<verify>` automated gate (which does not include this specific grep) passes cleanly.

## User Setup Required

None for this plan's own execution — no new external service was contacted. However, per the plan's `user_setup` frontmatter, the five Meta credentials documented in `.env.example` (`META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_ACCESS_TOKEN`, `META_AGENCY_PHONE_NUMBER_MAP`) still need real values sourced from developers.facebook.com before any downstream plan (03-03 onward) can be verified end-to-end against Meta's live API. Dashboard config task (adding test phone numbers to the test number's allowed recipient list) also remains outstanding — both are consumer-plan concerns, not blockers for this plan.

## Next Phase Readiness
- `inngest/client.ts` and `lib/tenant/with-system-webhook-context.ts` are now stable import targets for plans 03-05, 03-06, and 03-08 (wave 2+)
- `app/api/inngest/route.ts` is deliberately NOT created here — owned by plan 03-06
- No blockers for the next wave; real Meta credentials remain a prerequisite for live end-to-end verification (03-08) but not for continued code-level execution

---
*Phase: 03-integraci-n-con-whatsapp-meta*
*Completed: 2026-09-10*

## Self-Check: PASSED

- FOUND: inngest/client.ts
- FOUND: lib/tenant/with-system-webhook-context.ts
- FOUND: .planning/phases/03-integraci-n-con-whatsapp-meta/03-02-SUMMARY.md
- FOUND commit: 2474368
- FOUND commit: c8045be
- FOUND commit: 6d89984
- FOUND commit: 517d009
