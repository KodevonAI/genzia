---
phase: 03
slug: integraci-n-con-whatsapp-meta
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-09-10
updated: 2026-09-10
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None (project convention: hand-written `tsx` assertion scripts, no test runner — see `scripts/verify-identity-classification.ts`) |
| **Config file** | none — no runner to configure |
| **Quick run command** | `npx tsx scripts/verify-whatsapp-webhook-parsing.ts` |
| **Second quick command** | `npx tsx scripts/verify-whatsapp-send.ts` |
| **Full suite command** | `npm run db:verify-whatsapp` |
| **Regression suites** | `npm run db:verify-rls` (Phase 1, 7/7), `npm run db:verify-identity` (Phase 2, 16/18 — two known open failures documented in `02-07-SUMMARY.md`) |
| **Estimated runtime** | ~2s each quick / ~60s full (real Neon) |

Every task in every plan additionally carries `npx tsc --noEmit` and, for
code-producing tasks, `npx eslint <files>`. Those are the sub-second floor;
the scripts above are the behavioral proof.

---

## Sampling Rate

- **After every task commit:** `npx tsc --noEmit` plus whichever offline
  script covers the touched module (`verify-whatsapp-webhook-parsing.ts` for
  signature/parsing/ingestion-adjacent work, `verify-whatsapp-send.ts` for
  outbound work)
- **After every plan wave:** both offline scripts
- **After wave 4 / before `/gsd-verify-work`:** `npm run db:verify-whatsapp`
  green, both regression suites green, and a real manual WhatsApp
  message/ack round-trip confirmed by the user
- **Max feedback latency:** 60 seconds

Sampling continuity check: no plan has three consecutive tasks without an
automated verify — every task in plans 03-01 through 03-08 carries an
`<automated>` command.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-T1 | 03-01 | 1 | WA-04, WA-07 | T-03-11 | `messages` schema mirrors `ResolvedIdentity` values; Meta-supplied status/pricing columns carry no CHECK | typecheck + grep | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 03-01-T2 | 03-01 | 1 | WA-04 | T-03-10 | Global partial unique index on `team_members.whatsapp_number` makes agency lookup deterministic | grep on generated SQL | `grep -q 'team_members_whatsapp_number_global_idx' drizzle/migrations/0012_whatsapp_messages.sql` | ❌ W1 | ⬜ pending |
| 03-01-T3 | 03-01 | 1 | WA-04 | T-03-04, T-03-05, T-03-09 | SECURITY DEFINER fn returns only `agency_id`; `unknown` scope matches no policy | grep on migration SQL | `grep -q "SET search_path = public" drizzle/migrations/0013_whatsapp_messages_rls.sql` | ❌ W1 | ⬜ pending |
| 03-02-T1 | 03-02 | 1 | WA-01, WA-03 | T-03-06 | Meta credentials documented, never valued, in `.env.example` | node assertion | `node -e "..."` (see plan) | ❌ W1 | ⬜ pending |
| 03-02-T2 | 03-02 | 1 | WA-01 | — | Typed event contract shared by producer and consumer | typecheck | `npx tsc --noEmit` | ❌ W1 | ⬜ pending |
| 03-02-T3 | 03-02 | 1 | WA-03 | T-03-05, T-03-09 | System-actor scope sets exactly `app.agency_id` + `app.actor`, no role | typecheck + grep | `npx tsc --noEmit && grep -c "set_config" lib/tenant/with-system-webhook-context.ts` | ❌ W1 | ⬜ pending |
| 03-02-T4 | 03-02 | 1 | WA-04 | T-03-10 | Cross-agency WhatsApp collision fails loud and translated | typecheck + lint + i18n parity | `npx tsc --noEmit && npx eslint ...` | ❌ W1 | ⬜ pending |
| 03-03-T1 | 03-03 | 1 | WA-05 | T-03-01, T-03-02, T-03-13, T-03-14 | Constant-time HMAC; throw-free parser; media reference only, never downloaded | typecheck + lint | `npx tsc --noEmit && npx eslint lib/webhooks/verify-meta-signature.ts lib/whatsapp/parse-webhook-payload.ts` | ❌ W1 | ⬜ pending |
| 03-03-T2 | 03-03 | 1 | WA-05 | T-03-01, T-03-02, T-03-13, T-03-14 | Tampered/missing/short signature rejected; E.164 normalization; all four message types; malformed payloads yield empty results | unit (no network) | `npx tsx scripts/verify-whatsapp-webhook-parsing.ts` | ❌ W1 | ⬜ pending |
| 03-04-T1 | 03-04 | 1 | WA-01 | T-03-06, T-03-16, T-03-17 | Direct Graph API call, no SDK, no hand-rolled retry, token never in errors | typecheck + lint | `npx tsc --noEmit && npx eslint lib/whatsapp/send-message.ts` | ❌ W1 | ⬜ pending |
| 03-04-T2 | 03-04 | 1 | WA-01 | T-03-06, T-03-16 | Exact outbound URL/method/headers/body pinned; credential guard runs before any fetch | unit (stubbed fetch) | `npx tsx scripts/verify-whatsapp-send.ts` | ❌ W1 | ⬜ pending |
| 03-05-T1 | 03-05 | 2 | WA-02, WA-03, WA-04 | T-03-04, T-03-07, T-03-12 | Agency routing via env allowlist + SECURITY DEFINER lookup; malformed map degrades safely | typecheck + lint + regression | `npx tsc --noEmit && npx tsx scripts/verify-whatsapp-webhook-parsing.ts` | ❌ W1 | ⬜ pending |
| 03-05-T2 | 03-05 | 2 | WA-03, WA-04 | T-03-03, T-03-05, T-03-18, T-03-19 | Agency then identity then write; `withSystemWebhookContext` only; idempotent insert | typecheck + lint + regression | `npx tsc --noEmit && npx eslint lib/whatsapp/ingest-inbound-message.ts` | ❌ W1 | ⬜ pending |
| 03-06-T1 | 03-06 | 2 | WA-01, WA-07 | T-03-15, T-03-16, T-03-21 | Two named steps so a retry never re-sends; fixed ack text; no LLM | typecheck + lint + regression | `npx tsc --noEmit && npx tsx scripts/verify-whatsapp-send.ts` | ❌ W1 | ⬜ pending |
| 03-06-T2 | 03-06 | 2 | WA-01 | T-03-20 | Inngest serve handler is wiring only; SDK owns its own request verification | build | `npx next build` | ❌ W1 | ⬜ pending |
| 03-07-T1 | 03-07 | 3 | WA-07 | T-03-25 | Pricing/status backfill bounded by agency + wamid; never nulls prior pricing | typecheck + lint | `npx tsc --noEmit && npx eslint lib/whatsapp/record-delivery-status.ts` | ❌ W1 | ⬜ pending |
| 03-07-T2 | 03-07 | 3 | WA-01, WA-03, WA-05 | T-03-01, T-03-03, T-03-22, T-03-23, T-03-24 | Raw body verified before parse; 400 before any DB access; ack gated on new insert; bare challenge string | typecheck + lint + build | `npx tsc --noEmit && npx next build` | ❌ W1 | ⬜ pending |
| 03-08-T1 | 03-08 | 4 | WA-01, WA-03, WA-04, WA-05, WA-07 | T-03-03, T-03-04, T-03-05, T-03-18, T-03-27 | Real-Neon proof of lookup, all three identity branches, idempotency, media, pricing, all four RLS boundaries | integration (real Neon) | `npm run db:verify-whatsapp` | ❌ W1 | ⬜ pending |
| 03-08-T2 | 03-08 | 4 | all | T-03-26 | `[BLOCKING]` migrations applied to real Neon; no Phase 1/2 regression | integration (real Neon) | `npm run db:migrate && npm run db:verify-whatsapp && npm run db:verify-rls && npm run db:verify-identity` | ❌ W1 | ⬜ pending |
| 03-08-T3 | 03-08 | 4 | WA-01, WA-03, WA-05, WA-07 | T-03-28 | Real inbound message produces exactly one real ack; media stored by reference | manual | Manual — see plan 03-08 Task 3 | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*"File Exists ❌ W1" = the verification file is created by the wave-1 plan that owns it, before any consumer needs it.*

---

## Wave 0 Requirements

There is no separate Wave 0: every verification artifact is created inside
wave 1, in the same plan as the code it proves, and nothing in wave 2+
depends on a verification file that does not yet exist.

- [ ] `scripts/verify-whatsapp-webhook-parsing.ts` — plan 03-03 Task 2 (signature valid/invalid/missing/short, E.164 normalization, text/image/audio/unsupported/status parsing, malformed-payload robustness). Covers D-05 and the signature pitfalls. No network.
- [ ] `scripts/verify-whatsapp-send.ts` — plan 03-04 Task 2 (outbound URL/method/headers/body, error surfacing, credential guard, token-leak check) against a stubbed `fetch`. No network.
- [ ] `scripts/verify-whatsapp-webhook.ts` — plan 03-08 Task 1 (real-Neon: cross-agency lookup, three identity branches, idempotency, media, WA-07 backfill, four RLS boundaries).
- [ ] `drizzle/migrations/0012_whatsapp_messages.sql` + `0013_whatsapp_messages_rls.sql` — plan 03-01, required before any integration assertion can run.
- [ ] `package.json` scripts `verify:whatsapp-parsing`, `verify:whatsapp-send`, `db:verify-whatsapp` — plan 03-02 Task 1 (single owner of `package.json` so wave-1 plans stay parallel).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real end-to-end WhatsApp round-trip | D-01, WA-01, WA-03 | Requires a real Meta test WABA, an allowed test recipient, a public HTTPS tunnel, and network egress not guaranteed in sandboxed sessions | Plan 03-08 Task 3, steps 1-6: send a WhatsApp message to the test number from an added recipient and confirm exactly one `Mensaje recibido` arrives, then confirm both rows in `messages` |
| WABA-to-App webhook subscription registration | WA-03 | The Meta dashboard toggle can silently fail to persist (RESEARCH.md Pitfall 2); needs the explicit `POST /{WABA_ID}/subscribed_apps` call and a confirming GET | Plan 03-08 Task 3, step 3 |
| Meta webhook URL verification handshake | WA-01 | Only Meta's own "Verify and Save" exercises the GET handler end to end | Plan 03-08 Task 3, step 2 |
| Migration application against real Neon | all | DDL against the production database; egress varies per session | Plan 03-08 Task 2 (`[BLOCKING]`) |
| Media (voice note / photo) stored by reference only | WA-05, D-05 | Requires sending real media from a real phone | Plan 03-08 Task 3, step 7 |

---

## Validation Sign-Off

- [x] All tasks have an `<automated>` verify command
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Every verification file is created in wave 1, before any consumer needs it
- [x] No watch-mode flags
- [x] Feedback latency < 60s for every non-integration command
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved by planner, 2026-09-10
