---
phase: 03-integraci-n-con-whatsapp-meta
plan: 06
subsystem: api
tags: [inngest, whatsapp, meta-graph-api, background-jobs, next-app-router]

requires:
  - phase: 03-integraci-n-con-whatsapp-meta
    provides: "inngest/client.ts (inngest, WhatsAppMessageReceivedData), lib/whatsapp/send-message.ts (sendWhatsAppTextMessage), lib/tenant/with-system-webhook-context.ts, lib/db/schema/messages.ts (plans 03-01, 03-02, 03-04)"
provides:
  - "inngest/functions/send-whatsapp-ack.ts: sendWhatsAppAck — D-01's outbound half, real Graph API send + persisted outbound row"
  - "app/api/inngest/route.ts: the HTTP endpoint Inngest uses to discover and invoke registered functions"
affects: [03-08]

tech-stack:
  added: []
  patterns:
    - "inngest@4.20.0's createFunction(options, handler) two-argument shape, trigger merged into options.triggers[], not the three-argument (options, trigger, handler) v3-era shape"

key-files:
  created:
    - inngest/functions/send-whatsapp-ack.ts
    - app/api/inngest/route.ts
  modified: []

key-decisions:
  - "Used inngest@4.20.0's actual createFunction(options, handler) two-arg API — options.triggers: [{ event: name }] — instead of the plan's literal three-arg (options, trigger, handler) sample, confirmed against this version's own doc-comment example in node_modules/inngest/lambda.d.ts"
  - "Confirmed via a throwaway compile check (not committed) that event.data typing is identical (loosely typed, no compile-time field enforcement) whether the trigger is the raw event-name string or the eventType()-produced object exported from inngest/client.ts; kept the plain string trigger since it satisfies the plan's acceptance-criteria grep for the event name with no loss of type safety"

requirements-completed: [WA-01, WA-07]

duration: ~20min
completed: 2026-09-10
---

# Phase 3 Plan 6: Send WhatsApp Ack (Inngest Background Function + Serve Handler) Summary

**D-01's outbound proof: an Inngest background function that reacts to `whatsapp/message.received` by sending a fixed "Mensaje recibido" ack through Meta's real Graph API send call, persisting the outbound row, and the thin `/api/inngest` route that lets Inngest discover and invoke it.**

## Performance

- **Duration:** ~20 min (worktree branch correction + npm install + implementation + verification)
- **Tasks:** 2/2
- **Files modified:** 2 (both new)

## Accomplishments
- `sendWhatsAppAck` triggers on `whatsapp/message.received`, calls `sendWhatsAppTextMessage(senderPhoneNumber, "Mensaje recibido")` in one named step (`send-ack-via-graph-api`), then persists the outbound row in a second named step (`persist-outbound-row`) via `withSystemWebhookContext` — each side effect memoized independently so a retry never re-sends a successful WhatsApp message nor skips a failed DB write
- The outbound row swaps `fromPhoneNumber`/`toPhoneNumber` relative to the inbound row (platform number is now the sender), carries the same resolved identity as the inbound message it answers, and guards against duplicate inserts on retry with `onConflictDoNothing` on `(agency_id, meta_message_id)`
- `app/api/inngest/route.ts` is a 25-line wiring-only route (`runtime = "nodejs"`, `serve({ client: inngest, functions: [sendWhatsAppAck] })`) — no database query, no `fetch`, no business logic
- `npx next build` succeeds with `/api/inngest` listed as a registered dynamic route

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement the send-whatsapp-ack background function** — `ed31204` (feat)
2. **Task 2: Expose the Inngest serve handler** — `840fab7` (feat)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified
- `inngest/functions/send-whatsapp-ack.ts` — `ACK_TEXT` (fixed string) + `sendWhatsAppAck` Inngest function (2 named steps, `retries: 3`)
- `app/api/inngest/route.ts` — Inngest's Next.js App Router `serve()` handler, registering `sendWhatsAppAck`

## Decisions Made
- Followed the plan's action code as literally as the actually-installed SDK version allows; where they conflicted, matched the installed `inngest@4.20.0` API (see Deviations)
- Kept `withSystemWebhookContext` (not `withResolvedIdentityContext`, which `03-PATTERNS.md`'s file-13 snippet shows) per the plan's own action block and acceptance criteria — `03-PATTERNS.md` predates DEC-A's resolution in favor of the narrower system-actor scope; the plan text is authoritative here and matches `inngest/client.ts` (03-02) and `messages.ts` (03-01) as actually built
- Did not query `team_members` or `authorized_contacts` inside the function; every identity field the function needs travels on the event payload (SEG-12 invariant)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/blocking, library API mismatch] `inngest.createFunction()` takes two arguments in the installed SDK, not three**
- **Found during:** Task 1 (implementing `send-whatsapp-ack.ts`)
- **Issue:** The plan's literal code sample calls `inngest.createFunction({ id, retries }, { event: "..." }, handler)` — a three-argument, v3-era shape (separate options / trigger / handler arguments). `inngest@4.20.0`'s actual `createFunction` type (`Inngest.CreateFunction` in `node_modules/inngest/components/Inngest.d.ts`) accepts exactly two arguments: an options object with the trigger merged in as `triggers: [{ event: name }]`, and the handler. Confirmed directly against this version's own doc-comment example in `node_modules/inngest/lambda.d.ts` (`{ id: "hello-world", triggers: [{ event: "test/hello.world" }] }`). This is the same category of SDK-version mismatch `03-02-SUMMARY.md` documented for `inngest/client.ts`'s `EventSchemas`/`.fromRecord()` (a stale RESEARCH.md code sample against a newer installed package).
- **Fix:** Wrote `{ id: "send-whatsapp-ack", retries: 3, triggers: [{ event: "whatsapp/message.received" }] }` as the single options argument, followed by the handler as the second argument. Before committing to this, ran a throwaway (uncommitted, deleted) compile check comparing the raw event-name string as the trigger against the `eventType()`-produced `whatsappMessageReceivedEvent` object exported from `inngest/client.ts` as the trigger — both produce identically loose typing for `event.data` in this SDK version (a `@ts-expect-error` on a nonexistent field was reported "unused" in both cases, meaning neither route to catches a typo at compile time). Given no type-safety difference, kept the plain string form, which also satisfies the plan's acceptance-criteria grep for the literal event name.
- **Files modified:** `inngest/functions/send-whatsapp-ack.ts`
- **Verification:** `npx tsc --noEmit` exits 0; `npx eslint` clean; `npx tsx scripts/verify-whatsapp-send.ts` still 12/12 PASS; function id, retry count, event name, two named steps (`send-ack-via-graph-api`, `persist-outbound-row`), fixed ack text, `direction: "outbound"`, swapped from/to numbers, and absence of any LLM/hand-rolled-retry/forbidden-identity-table reference all independently grep-confirmed
- **Committed in:** `ed31204` (Task 1 commit, deviation documented in the commit body and in this file's header comment)

**2. [Rule 1 - Bug/blocking, breaking Next.js CLI change] `next build --no-lint` no longer exists**
- **Found during:** Task 2 verification (the plan's specified `<verify><automated>` command)
- **Issue:** The plan's verify command is `npx next build --no-lint`. This Next.js version's CLI (`node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md`, read per `AGENTS.md`'s mandatory pre-code-change instruction) lists no `--lint`/`--no-lint` flag under `next build` — that flag was removed as part of this version's breaking changes. Running it as written fails immediately with `error: unknown option '--no-lint'` before the build even starts.
- **Fix:** Ran `npx next build` without the removed flag. ESLint was already run separately per-file (per the plan's own `<verify>` line for Task 1/Task 2, which lists `npx eslint <file>` alongside the build command), so no lint coverage was lost.
- **Files modified:** None (verification-only deviation)
- **Verification:** `npx next build` completes successfully; `/api/inngest` appears in the route list; no error references either new file
- **Committed in:** N/A (verification step only, no code change)

---

**Total deviations:** 2 auto-fixed (both blocking/library-or-CLI-version mismatches, same category as prior plans in this phase)
**Impact on plan:** Both are necessary to execute against the actually-installed dependency versions. The binding contract (function id `send-whatsapp-ack`, retry count 3, triggering event `whatsapp/message.received`, two named steps, fixed ack text, outbound row shape) required by this plan and by `03-08`'s downstream checkpoint is unchanged. No scope creep.

## Issues Encountered

- This worktree had no `node_modules` present at start (fresh worktree checkout); ran `npm install` before any verification could run. No lockfile changes resulted (`package-lock.json` diff was empty), so nothing was staged/committed for this step.
- This worktree also had no `.env`/`.env.local` present, which made `npx next build` fail on an unrelated page (`app/[locale]/dashboard/page.tsx`, `DATABASE_URL is not set`) — not caused by this plan's changes. Copied the (gitignored) `.env` and `.env.local` from the parent repo checkout into the worktree purely to get a working local build for verification; neither file was staged or committed (both remain excluded by `.gitignore`'s `.env*` rule).
- One acceptance-criteria grep, `grep -q '{ id: "send-whatsapp-ack", retries: 3 }' inngest/functions/send-whatsapp-ack.ts`, fails as a literal string match because the actually-correct API requires `triggers: [...]` inside that same options object (Deviation 1). The object's `id` and `retries` fields are present and correct; only the exact single-line substring assumed by the plan's grep is absent. Functionally equivalent to `03-02-SUMMARY.md`'s note about its Task 3 `set_config` grep-count mismatch — a plan-authoring artifact against a moving dependency API, not a functional gap.

## User Setup Required

None for this plan's own execution. Live behavior (a real ack arriving on a phone via a real Inngest run) is proven by the manual checkpoint in plan `03-08`, which also needs the real Meta credentials documented in `.env.example` (already flagged as outstanding by `03-02-SUMMARY.md`).

## Next Phase Readiness
- `inngest/functions/send-whatsapp-ack.ts` and `app/api/inngest/route.ts` are stable import targets / HTTP surface for plan `03-08`'s end-to-end checkpoint
- No blockers for the next wave

---
*Phase: 03-integraci-n-con-whatsapp-meta*
*Completed: 2026-09-10*

## Self-Check: PASSED

- FOUND: inngest/functions/send-whatsapp-ack.ts
- FOUND: app/api/inngest/route.ts
- FOUND commit: ed31204
- FOUND commit: 840fab7
