---
phase: 5
slug: gestion-clientes-crm-conversacional
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-14
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None (no jest/vitest/pytest) — hand-rolled `tsx scripts/verify-*.ts` against real Neon, established since Phase 1 |
| **Config file** | none — see `package.json`'s `db:verify-*`/`verify:*` scripts |
| **Quick run command** | `npx tsc --noEmit && npx eslint .` |
| **Full suite command** | `npm run db:verify-rls && npm run db:verify-agent-rls && npm run db:verify-agent` |
| **Estimated runtime** | ~60s quick, ~180s full (requires `DATABASE_URL` real network egress) |

---

## Sampling Rate

- **After every task commit:** Run `npx tsc --noEmit && npx eslint .`
- **After every plan wave:** Run `npm run db:verify-rls && npm run db:verify-agent-rls && npm run db:verify-agent`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

Task IDs assigned by planner — this table maps requirement → verification, not yet task-numbered.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | CLI-01 | V4 Access Control | Member creates client via form/dictation, gets auto-assigned | integration (real Neon) | extend `scripts/verify-agent-rls.ts` with member-role INSERT assertion | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CLI-03 | V4 Access Control | Member edits assigned client, cannot edit unassigned client | integration (real Neon) | extend `scripts/verify-agent-rls.ts` / `verify-rls-isolation.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CLI-04 | V4 Access Control | `list_clients`/web search returns only RLS-visible rows, filtered by text | integration (real Neon) | new assertions in `verify-agent-rls.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CLI-02/CLI-05 | V4 Access Control | Ficha shows real conversation history scoped to one client | manual + integration (existing `messages_select_by_role` coverage) | visual/manual check per UI-SPEC | n/a | ⬜ pending |
| TBD | TBD | TBD | D-07 | — | Agent refuses to create with no phone/email, asks back | unit-ish (no DB, pure function) | tool `execute()`/`isValidInput` logic, covered inside `db:verify-agent` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | D-08/SEG-10 | Elevation of Privilege | `create_client`/`update_client` classify as `low`, auto-execute | integration (real Neon) | extend `scripts/verify-agent-rls.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Extend `scripts/verify-agent-rls.ts` (or new `scripts/verify-clients-crm.ts`) with member-vs-admin write assertions for the new RLS policies (`clients_insert_by_team_member`/`clients_update_by_role`) — catches any regression on the RLS write-gap pitfall (write-only policy currently blocks non-admin INSERT/UPDATE).
- [ ] Extend the same script with `create_client`/`update_client`/`list_clients`/`get_client` risk-classification assertions — catches any regression on the risk-interceptor `clientId`-required pitfall.
- [ ] No new test framework install needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|--------------------|
| Ficha visual layout (field layering, placeholders, assignment panel) | CLI-02, CLI-05 | Visual/UX correctness per UI-SPEC not machine-checkable | Open `/dashboard/clients/[clientId]` as admin and as assigned member; confirm notes box has lock icon + caption, pagos/citas placeholders render empty-state copy, assignment chips + reassign control show admin-only |
| Agent dictation flow end-to-end (create + duplicate-name confirm) | CLI-01, D-09 | Requires live LLM turn, not scriptable offline | Dictate a new client via chat with a missing required field, confirm agent asks back; dictate a name matching an existing client, confirm agent asks to confirm same/new |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (plan 05-08 authors `verify-clients-crm.ts`; live-Postgres proof deferred to 05-10, mirroring Phase 4's pattern)
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-09-14 — confirmed by gsd-plan-checker: 10 plans/6 waves satisfy every Nyquist requirement above
