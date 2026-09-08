---
phase: 02
slug: modelo-identidad-permisos
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-08
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None installed — project convention is a standalone `tsx` script with a hand-rolled `check()`/`assertRowCount()` helper (see `scripts/verify-rls-isolation.ts`), not Vitest/Jest. D-07 mandates following this same pattern. |
| **Config file** | none — Wave 0 creates the scripts directly |
| **Quick run command** | `npx tsx scripts/verify-identity-classification.ts` |
| **Full suite command** | `npx tsx scripts/verify-identity-resolution.ts` |
| **Estimated runtime** | ~5s (classification, no network) / ~30s (resolution, real Neon) |

---

## Sampling Rate

- **After every task commit:** Run `npx tsx scripts/verify-identity-classification.ts` (no network — safe in sandbox)
- **After every plan wave:** Run `npx tsx scripts/verify-identity-resolution.ts` (requires local/CI Neon access)
- **Before `/gsd-verify-work`:** Full suite must be green, from local/CI — not sandbox
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-0X | 01 | 0 | SEG-01 | — | `scripts/verify-identity-classification.ts` created with pure `classifyIdentity` cases | unit | `npx tsx scripts/verify-identity-classification.ts` | ❌ W0 | ⬜ pending |
| 02-01-0X | 01 | 0 | SEG-01, SEG-02, SEG-03, SEG-04, SEG-07, SEG-12 | — | `scripts/verify-identity-resolution.ts` created (integration) | integration | `npx tsx scripts/verify-identity-resolution.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SEG-01 | — | Resolve team number, client A, client B, unknown number (ROADMAP success criterion) | integration | `npx tsx scripts/verify-identity-resolution.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SEG-02 | Pitfall (dup phone) | Second insert of same phone to a different client raises a clear DB error | integration | `npx tsx scripts/verify-identity-resolution.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SEG-03 | T-02-01 | Write to `authorized_contacts` fails when GUC role is `client_contact` or unset | integration | `npx tsx scripts/verify-identity-resolution.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SEG-04 | — | Inserting `opt_in_confirmed = true` without confirmer/timestamp violates CHECK constraint | integration | `npx tsx scripts/verify-identity-resolution.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SEG-07 | T-02-01 | `client_contact` GUC scope sees only its own client, never another | integration | `npx tsx scripts/verify-identity-resolution.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SEG-12 | T-02-01 | Unknown number gets zero rows from any tenant table | integration | `npx tsx scripts/verify-identity-resolution.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | Pitfall 1 | T-02-02 | Same phone cannot be both `team_members.whatsapp_number` and `authorized_contacts.phone_number` | integration | `npx tsx scripts/verify-identity-resolution.ts` | ❌ W0 | ⬜ pending |

*Task IDs marked TBD — planner fills these in once PLAN.md task numbering exists; requirement/behavior mapping above is authoritative from RESEARCH.md.*

---

## Wave 0 Requirements

- [ ] `scripts/verify-identity-classification.ts` — pure `classifyIdentity` unit cases (no network, sandbox-safe)
- [ ] `scripts/verify-identity-resolution.ts` — full integration suite covering the ROADMAP's 4 required cases + SEG-02/03/04/07/12 + Pitfall 1's collision case (real Neon, local/CI only)
- [ ] No framework install needed — `tsx` is already a devDependency

---

## Manual-Only Verifications

*None — all phase behaviors have automated verification (unit for the pure classifier, integration for RLS/GUC behavior against real Neon).*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
