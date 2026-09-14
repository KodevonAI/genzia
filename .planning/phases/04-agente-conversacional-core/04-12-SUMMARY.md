# 04-12 — Live-Neon checkpoint: SUMMARY

**Plan:** 04-12 (phase gate for 04-agente-conversacional-core)
**Tasks:** 3/3 complete
**Duration:** ~4h (spans tooling upgrade, live debugging, two human checkpoints)

## Task 1 — Migrations + suite matrix

Migrations 0014-0017 applied to real Neon (`neondb_owner` role via the SQL
editor — `app_user`, the role in `.env`'s `DATABASE_URL`, lacks DDL rights
by design; `npm run db:migrate` confirmed this with `permission denied for
database neondb`, exactly as `scripts/migrate.ts`'s own header predicts).

Exact suite counts, in order:
- `verify:identity-classification` — 7/7
- `verify:whatsapp-parsing` — 19/19
- `verify:whatsapp-send` — 12/12
- `verify:agent-prompt` — 10/10
- `verify:agent-media` — 9/9
- `db:verify-rls` — 7/7
- `db:verify-identity` — 16/18 (failures `8b`/`8c`, the known open SEG-12 gap from 02-07, unchanged)
- `db:verify-whatsapp` — 28/28
- `db:verify-agent-rls` — 12/12 (after fix, see below)
- `db:verify-agent` — 23/23 (after fix, see below)

`select count(*) from agencies where id like 'verify-%'` → 0 after every run.

### Real bugs found and fixed (Rule 1) — Task 1

1. **`lib/agent/audit.ts` (`writeAuditLog`, the only `audit_log` writer):**
   used `.returning({id})` after an INSERT under `withSystemWebhookContext`.
   Postgres requires a RETURNING row to also pass the table's SELECT policy;
   `audit_log_select_by_role` deliberately grants the `system_webhook` actor
   no read access (LD-04). Every real production audit write would have
   failed RLS. Fixed by generating `id` client-side and dropping RETURNING.
2. **`lib/agent/tools/deliver-to-client.ts`:** `onConflictDoNothing` on the
   outbound `messages` insert omitted the `where meta_message_id is not
   null` predicate needed to match the partial unique index —
   `ingest-inbound-message.ts` already had this exact pattern with a comment
   explaining why; this call site didn't. Every low-risk send (payment
   reminders) would have failed with "no unique or exclusion constraint
   matching". Fixed by adding the same `where` clause.
3. **`scripts/verify-agent-rls.ts`:** same RETURNING bug in its own seed
   data (same fix), plus a separate bug in its `errorMessage()` helper — it
   only read `err.message` (Drizzle's generic "Failed query" wrapper) and
   never unwrapped `err.cause.message`, where Postgres's actual "permission
   denied" text lives. Assertion (12) was failing because the helper
   couldn't see the real error, not because the REVOKE didn't work.

Commit: `213b515`.

## Task 2 — Multi-turn, multimodal conversation (human checkpoint)

Bootstrapped the agency/admin/client fixtures by hand (no earlier phase
ever exercised these against real Neon or a real Clerk session — see
"Environment gaps found" below), then drove the actual `/dashboard/chat`
UI in a real browser as the signed-in admin.

- **Multi-turn memory:** confirmed — a follow-up ("¿repetís lo que
  pregunté?") correctly referenced the prior turn's literal content.
  Survived a full page refresh.
- **SEG-09 disclosure:** the agent volunteers "soy un asistente automático
  (IA)" in its own greeting, and on direct question answered "Sí, soy una
  IA... No soy una persona" with no hedging.
- **Image understanding:** a real screenshot (Wikipedia's African bush
  elephant article) was described accurately in detail — species, infobox,
  conservation status, page layout.
- **Voice note:** **not independently confirmed.** `DEEPGRAM_API_KEY` is
  still unprovisioned (known gap, flagged before starting). Additionally,
  the audio upload path itself could not be exercised through browser
  automation: Chrome reported the uploaded `.m4a` file's MIME type as
  `application/octet-stream` (a tooling artifact of synthetic file
  injection, not a real user's native file picker), so
  `sendWebChatTurn`'s `mimeType.startsWith("audio/")` branch never ran and
  no placeholder text reached the model. User explicitly deferred
  re-verifying this by hand.
- **Scope check (member without client assignments):** **not
  independently re-tested live** — would have required inviting a second
  real team member and a second authenticated browser session. Deferred by
  explicit user decision; SEG-06 is already proven against real Postgres by
  `db:verify-agent` assertions 2-3 and `db:verify-agent-rls` assertions 7-8.

## Task 3 — High-risk approval loop (human checkpoint)

Created a test client + authorized contact (opt-in confirmed) via SQL,
since no client-creation UI exists yet in this codebase (out of scope for
phases 1-4).

- Asked the agent to draft and send new content → it queued the proposal
  and explicitly said the message had **not** gone out yet, pending team
  approval (no SEG-09/SEG-10 false claim).
- Bitácora showed the pending item under "Pendientes de aprobación" with
  an Alto riesgo tag before any decision.
- **Approve → executed for real:** `approval_queue.status` went
  `pending → approved → executed`, and the real WhatsApp Graph API call
  returned a `wamid` (the send genuinely went through — Meta's App Review
  gap did not block this particular send). `audit_log` shows
  `approved_executed`.
- **Reject → never executed:** a second proposal, rejected, produced
  `audit_log.status = 'rejected'` and no queue-row execution.

### Real bugs found and fixed (Rule 1) — Task 3

Getting the approval loop to actually run uncovered two more bugs that
would have blocked SEG-10's execution half in **every** environment,
not just this local session — no earlier plan had ever exercised a live
Inngest run:

4. **`middleware.ts`:** the Clerk public-route allowlist covered
   `/api/webhooks(.*)` but not `/api/inngest(.*)`. Inngest's dev server (and
   its production runner) calls that route from outside any Clerk session;
   `auth.protect()` silently rejected every sync and step-execution
   callback. The Inngest dashboard showed `Error: url_not_found` for a
   route that plainly exists, and `curl -i` showed Clerk rewriting the
   request to a dev-browser handshake page. Fixed by adding
   `/api/inngest(.*)` to the allowlist — same posture as the Clerk/Meta
   webhooks, since the Inngest SDK verifies its own signing key inside
   `serve()`.
5. **`inngest/functions/execute-approved-action.ts`:** the
   `resolve-approver-role` step read `team_members` through the plain
   unscoped `db` export. That table's `FORCE ROW LEVEL SECURITY` policy
   requires `app.agency_id` via `current_setting`; an unscoped call sets no
   GUC, so the policy silently filtered out every row regardless of the
   `WHERE` clause, throwing "no se encontró team_member" for an id that
   plainly exists. Fixed by pairing a transaction-local `set_config` with
   the read via `db.batch`, the same mechanism
   `lib/agencies/create-agency.ts` already uses for its own unscoped write.

Commit: `e4c8fc6`.

## Environment gaps found (not code bugs, but blocked this checkpoint until fixed)

- **`INNGEST_DEV`/`INNGEST_SIGNING_KEY` were never documented in
  `.env.example`.** Without `INNGEST_DEV=1`, the SDK defaults to "cloud
  mode" and every Inngest call 500s with "no signing key found". Added to
  `.env.example` and set locally.
- **No `agencies`/`team_members` rows existed at all** — the Clerk
  `organization.created`/`organizationMembership.created` webhooks can
  never reach `localhost` without a public tunnel, so local dev had never
  actually onboarded a real agency before this checkpoint. Bootstrapped by
  hand via direct SQL (matching exactly what `createAgencyFromClerkOrg` /
  `syncTeamMemberFromClerkMembership` would have written) rather than via a
  webhook replay — an attempted Svix-signed webhook replay was blocked by
  Claude Code's own auto-mode safety classifier ("Credential
  Materialization") when it tried to read `CLERK_WEBHOOK_SECRET`, correctly
  treating that as a boundary this session shouldn't cross.

## Other deviations

- **Unrelated LLM model swap, by explicit user request mid-checkpoint:**
  `MODEL_FOR_TASK.main` changed from `anthropic/claude-sonnet-5` to
  `deepseek/deepseek-v4.1-flash` (commit `1721a99`). Not a phase deliverable
  — noted here because it happened inside this plan's window and changes
  what the live-chat evidence above was actually running against for Task
  3 (Task 2's chat evidence predates the swap; Task 3's does not).
- **Unrelated chat UI redesign, also user-driven, committed at the user's
  explicit request** (`d21c8be`): `components/ui/ai-chat-input.tsx` (new,
  `lucide-react` + `motion`) rewires `chat-panel.tsx`'s attachment/send
  controls. Not reviewed as part of this plan's scope.
- **Credential exposure risk, self-reported:** while debugging (a `grep -c`
  quirk this environment has previously documented — 03-08-SUMMARY.md's
  same warning — and a required `Read` of `.env` to append `INNGEST_DEV`),
  the Neon DB password, `CLERK_SECRET_KEY`, and `CLERK_WEBHOOK_SECRET`
  surfaced in this session's tool output. Flagged to the user live;
  recommended rotating all three after this session. Not written to any
  file this SUMMARY or a later reader would see.

## Carried-open gaps (unchanged by this plan, not failures of it)

1. **Meta App Review** (from 03-08): real inbound WhatsApp still can't
   reach `/api/webhooks/meta` in production until Meta approves the app.
   Outbound sending, however, is now confirmed working end-to-end
   (Task 3's real `wamid`).
2. **SEG-12** (from 02-07): `db:verify-identity` 16/18, same two known
   failures (`8b`/`8c`), unchanged.
3. **Voice-note transcription**: blocked on `DEEPGRAM_API_KEY`
   provisioning; the code path (placeholder degradation) is unit-tested
   (`verify-agent-media` assertion 8) but not exercised live end-to-end
   this session.

## Next Phase Readiness

Phase 4's core promise — RLS gaps closed against real Postgres, agent
responds with judgment on WhatsApp and web, SEG-10's propose→approve/
reject→execute loop working end-to-end against real infra — is proven.
Five real, previously-undetected bugs were found and fixed live; all were
invisible to typecheck/lint/offline tests and would have shipped broken.

---
*Phase: 04-agente-conversacional-core*
*Completed: 2026-09-14*

## Self-Check: PASSED

All 5 bug-fix commits confirmed present in `git log` (`213b515`, `e4c8fc6`,
plus the pre-existing wave commits). Migrations 0014-0017 confirmed live on
Neon via direct query. `approval_queue`/`audit_log` end states for both the
approve and reject runs confirmed via direct query. This SUMMARY.md is the
plan's only declared artifact.
