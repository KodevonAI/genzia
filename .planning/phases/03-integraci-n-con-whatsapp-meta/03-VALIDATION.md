---
phase: 03
slug: integraci-n-con-whatsapp-meta
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-10
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None (project convention: hand-written `tsx` assertion scripts, no test runner — see `scripts/verify-identity-classification.ts`) |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | `npx tsx scripts/verify-whatsapp-webhook-parsing.ts` |
| **Full suite command** | `npm run db:verify-whatsapp` |
| **Estimated runtime** | ~10s quick / ~60s full (real Neon + real Meta test WABA) |

---

## Sampling Rate

- **After every task commit:** Run `npx tsx scripts/verify-whatsapp-webhook-parsing.ts`
- **After every plan wave:** Run `npm run db:verify-whatsapp`
- **Before `/gsd-verify-work`:** Full suite must be green + a real manual end-to-end WhatsApp message/ack round-trip, confirmed by the user
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-XX-XX | TBD | 0 | WA-04/SEG-01 | Cross-agency data leak via SECURITY DEFINER fn | Function returns only `agency_id`, no other columns | integration | `npx tsx scripts/verify-whatsapp-webhook.ts` | ❌ W0 | ⬜ pending |
| 03-XX-XX | TBD | TBD | D-01 (outbound proof) | — | Real inbound triggers real outbound ack via Meta Graph API | manual + integration | `npx tsx scripts/verify-whatsapp-send.ts` | ❌ W0 | ⬜ pending |
| 03-XX-XX | TBD | TBD | Signature verification | Forged webhook / timing attack | Tampered/missing `X-Hub-Signature-256` rejected 400 before DB write, `crypto.timingSafeEqual` used | unit | `npx tsx scripts/verify-whatsapp-webhook-parsing.ts` | ❌ W0 | ⬜ pending |
| 03-XX-XX | TBD | TBD | D-04 idempotency | Replay of valid webhook payload | Duplicate `meta_message_id` does not create 2nd row or 2nd send | integration | `npx tsx scripts/verify-whatsapp-webhook.ts` | ❌ W0 | ⬜ pending |
| 03-XX-XX | TBD | TBD | D-05 media detection | — | Image/audio payload stores `media_id`/`mime_type`, `text_body` null, no download call | unit | `npx tsx scripts/verify-whatsapp-webhook-parsing.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky — plan/wave/task IDs to be filled once PLAN.md files exist.*

---

## Wave 0 Requirements

- [ ] `scripts/verify-whatsapp-webhook-parsing.ts` — signature verification (valid/invalid/missing header) + payload-shape parsing for text/image/audio/statuses, no network, covers D-05 and the signature pitfall
- [ ] `scripts/verify-whatsapp-webhook.ts` — real-Neon integration test: cross-agency lookup, idempotent insert, `withResolvedIdentityContext` scoping — covers WA-04 and D-04
- [ ] `scripts/verify-whatsapp-send.ts` — asserts outbound request shape (headers, body) against stubbed fetch, no live Meta call required
- [ ] `drizzle/migrations/0012_*.sql` — `messages` table + RLS policy + `find_agency_by_team_whatsapp_number` SECURITY DEFINER function, needed before any integration test above can run
- [ ] `package.json` script: `db:verify-whatsapp` — wired the same way as `db:verify-identity`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real end-to-end WhatsApp round-trip | D-01, WA-01, WA-03 | Requires real Meta test WABA, added test recipient, live network access not guaranteed in sandboxed sessions | Send a WhatsApp message to the test number from an added test recipient; confirm the system's fixed ack arrives back via the real WhatsApp app |
| WABA→App webhook subscription registration | WA-03 | Meta dashboard toggle can silently fail to register; needs the explicit `POST /{WABA_ID}/subscribed_apps` call confirmed against the live Meta dashboard | Verify subscription via Meta dashboard or Graph API GET after wiring, from a session with real network access |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
