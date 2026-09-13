---
phase: 4
slug: agente-conversacional-core
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-09-13
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Materialized from `04-RESEARCH.md`'s "Validation Architecture" section after plan-checker flagged the missing standalone file (Dimension 8 / check_8e).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None detected — no `jest.config.*`/`vitest.config.*`/`pytest.ini`. Continues the existing hand-written `tsx`-executed script convention under `scripts/` established in Phases 1-3 (e.g. `scripts/verify-whatsapp-webhook.ts`), run via `npm run db:verify-*` / `npm run verify:*`. |
| **Config file** | none — no framework install needed this phase |
| **Quick run command** | `npx tsc --noEmit` (fast offline gate, matches Phase 2/3's pattern before any live-DB script) |
| **Full suite command** | `npm run db:verify-rls && npm run db:verify-identity && npm run db:verify-whatsapp && npm run db:verify-agent-rls && npm run db:verify-agent` (existing three regression suites plus the two new agent suites) |
| **Estimated runtime** | ~30-60s (real-Neon HTTP round trips dominate, same order of magnitude as Phase 3's suites) |

---

## Sampling Rate

- **After every task commit:** `npx tsc --noEmit` (and the task's own `<automated>` command from its PLAN.md)
- **After every plan wave:** the full suite command above
- **Before `/gsd-verify-work`:** full suite must be green, including the two known-open SEG-12 failures in `db:verify-identity` (16/18 is the PASS condition, per `02-07-SUMMARY.md` and `04-12-PLAN.md`)
- **Max feedback latency:** ~60s (no watch-mode flags anywhere in this phase's scripts)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|--------------------|-------------|--------|
| 04-01-T1 | 04-01 | 1 | SEG-11 | T-04-* (audit_log RLS) | `audit_log` read: admin sees agency, member sees only assigned-client entries, client_contact sees zero rows | integration (real Neon) | `npx tsx scripts/verify-agent-rls.ts` | ❌ Wave 0 | ⬜ pending |
| 04-01-T2 | 04-01 | 1 | SEG-06/SEG-08 | T-04-* (messages RLS) | `messages_select_by_role` three-branch fix: member cannot read unassigned client's messages; team-internal (`client_id IS NULL`) visible to all members | integration (real Neon) | `npx tsx scripts/verify-agent-rls.ts` | ❌ Wave 0 | ⬜ pending |
| 04-02-T* | 04-02 | 1 | SEG-09 | T-04-* (disclosure bypass) | Every system prompt contains `AI_DISCLOSURE_RULE` verbatim, unconditionally | unit (no network) | `npm run verify:agent-prompt` | ❌ Wave 0 | ⬜ pending |
| 04-03-T* | 04-03 | 2 | SEG-10/SEG-11 | T-04-* (approval_queue RLS) | `approval_queue` RLS: solo-equipo, no `client_contact` branch, no DELETE grant | integration (real Neon), covered by `db:verify-agent` | `npm run db:verify-agent` | ❌ Wave 0 | ⬜ pending |
| 04-04-T* | 04-04 | 2 | SEG-05/06/07/08, SIS-01 | T-04-* (context leak) | `buildAgentContext`/`buildAgentContextInScope` never returns cross-client rows regardless of identity type; zero application-level client filters | integration (real Neon) | `npm run db:verify-agent` | ❌ Wave 0 | ⬜ pending |
| 04-05-T* | 04-05 | 2 | WA-05 | T-04-* (media SSRF/size) | Two-step Meta media download surfaces size/type errors; stubbed fetch, no real network | unit (stubbed fetch) | `npm run verify:agent-media` | ❌ Wave 0 | ⬜ pending |
| 04-06-T* | 04-06 | 3 | SEG-10/SEG-11/SEG-07 | T-04-* (interceptor bypass) | Low-risk tool auto-executes + writes `audit_log` (status=executed); high-risk tool does NOT execute, writes `approval_queue`+`audit_log` (status=pending); cross-check of tool-call args against resolved identity's real scope | integration (real Neon) | `npm run db:verify-agent` | ❌ Wave 0 | ⬜ pending |
| 04-07-T* | 04-07 | 4 | WA-05/SEG-09/SEG-10/SIS-01/SEG-05 | T-04-* (turn loop DoS) | `runTurn` bounded iteration count; `process-agent-turn` replaces the fixed ack as sole consumer of `whatsapp/message.received` | integration (real Neon) | `npm run db:verify-agent` | ❌ Wave 0 | ⬜ pending |
| 04-08-T* | 04-08 | 4 | SEG-10, SEG-05/06/07/08 | multiple | 23+ assertions over the SEG-10 engine and the SEG-05..08 context boundary, outbound sends stubbed and counted | integration (real Neon) | `npm run db:verify-agent` | ❌ Wave 0 | ⬜ pending |
| 04-09-T* | 04-09 | 5 | SEG-10 | T-04-* (approval bypass) | `approveAction`/`rejectAction` only transition pending rows; `execute-approved-action` re-validates scope before replay | integration (real Neon) | `npm run db:verify-agent` | ❌ Wave 0 | ⬜ pending |
| 04-10-T* | 04-10 | 5 | WA-05, SEG-05/09 | T-04-* (web-chat identity spoof) | `messages_web_chat_insert` pinned to `app.team_member_id`; web chat is team-only (LD-02) | integration (real Neon) + manual UI smoke | `npm run db:verify-agent` + manual | ❌ Wave 0 | ⬜ pending |
| 04-11-T* | 04-11 | 6 | SEG-11, SIS-01 | T-04-* (bitácora leak) | Bitácora readers are RLS-scoped with no additional role branching in application code | integration (real Neon), reuses `db:verify-agent-rls` | `npm run db:verify-agent-rls` | ❌ Wave 0 | ⬜ pending |
| 04-12-T* | 04-12 | 7 | all | — | [BLOCKING] apply migrations 0014-0017 to real Neon, run all suites with exact expected counts, two human checkpoints (real conversation, real approval) | integration (real Neon) + human-verify | `npm run db:migrate && npm run db:verify-agent-rls && npm run db:verify-agent && npm run db:verify-rls && npm run db:verify-identity && npm run db:verify-whatsapp` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/verify-agent-rls.ts` — the two RLS gap proofs (04-01): `audit_log` role branching, `messages` client_assignments check
- [ ] `scripts/verify-agent-prompt.ts` — SEG-09 disclosure injection, offline (04-02)
- [ ] `scripts/verify-agent-media.ts` — WA-05 media download/transcription, stubbed fetch, offline (04-05)
- [ ] `scripts/verify-agent.ts` — SEG-10 engine + approval_queue + SEG-05..08 context boundary, real Neon (04-08)
- [ ] `drizzle/migrations/0014_*.sql`, `0015_*.sql` — the two RLS fixes (04-01)
- [ ] `drizzle/migrations/0016_*.sql` — `approval_queue` table (04-03)
- [ ] `drizzle/migrations/0017_*.sql` — web-chat nullable phone columns + channel CHECK (04-10)
- [ ] `package.json` scripts: `db:verify-agent-rls`, `db:verify-agent`, `verify:agent-prompt`, `verify:agent-media` (all registered in 04-02)
- [ ] No test framework install needed — continues the existing hand-written-`tsx`-script convention

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|--------------------|
| A real multi-turn conversation over WhatsApp produces contextually correct agent replies | WA-05, SIS-01 | LLM output quality/coherence cannot be asserted by exact-match script | `04-12-PLAN.md`'s first human checkpoint: send a real multi-message WhatsApp conversation, confirm the agent's replies are contextually appropriate and the disclosure rule fires when asked directly |
| A high-risk action queued for approval is visible in the dashboard and a human approving it produces the real client-facing send | SEG-10, SEG-11 | End-to-end UI + human-approval-loop behavior, not just DB state | `04-12-PLAN.md`'s second human checkpoint: trigger a high-risk tool call, confirm it appears in the bitácora pending-approval view, approve it, confirm the replay actually sends |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (confirmed by plan-checker: every task across all 12 plans has an `<automated>` command)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (confirmed by plan-checker)
- [x] Wave 0 covers all MISSING references (all ❌ Wave 0 rows above have a corresponding Wave 0 Requirements entry)
- [x] No watch-mode flags (confirmed by plan-checker)
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-09-13
