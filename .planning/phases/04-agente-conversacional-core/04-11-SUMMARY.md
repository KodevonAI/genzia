---
phase: 04-agente-conversacional-core
plan: 11
subsystem: ui
tags: [next.js, drizzle, rls, next-intl, dashboard]

requires:
  - phase: 04-01
    provides: "audit_log_select_by_role RLS fix (migration 0014)"
  - phase: 04-03
    provides: "approval_queue table + audit_log status/approval_id columns (migration 0016)"
  - phase: 04-09
    provides: "approveAction/rejectAction Server Actions (lib/agent/approvals.ts)"
  - phase: 04-10
    provides: "the dashboard chat page + nav pattern this plan extends"
provides:
  - "listAuditLog / listRecentConversationMessages (lib/audit/list-audit-log.ts)"
  - "listPendingApprovals / listRecentDecidedApprovals (lib/agent/list-approvals.ts)"
  - "/dashboard/bitacora: pending approvals with working approve/reject, the action log, and conversation history"
affects: [04-12]

tech-stack:
  added: []
  patterns:
    - "RLS-only visibility reader: withTenantContext with zero client_id/app.role filter in application code (LD-17)"
    - "LEFT JOIN + defensive fallback to a raw FK code when a joined label is typed nullable but is guaranteed present by a NOT NULL FK to a static catalog"

key-files:
  created:
    - lib/audit/list-audit-log.ts
    - lib/agent/list-approvals.ts
    - "app/[locale]/dashboard/bitacora/page.tsx"
    - "app/[locale]/dashboard/bitacora/approval-row.tsx"
    - "app/[locale]/dashboard/bitacora/audit-list.tsx"
  modified:
    - "app/[locale]/dashboard/layout.tsx"
    - messages/es.json
    - messages/en.json

key-decisions:
  - "actionLabel from the agent_action_catalog LEFT JOIN falls back to the raw action_type_code rather than being left nullable in the public type — the FK guarantees a match in practice (static, row-locked catalog), but the LEFT JOIN's own type is nullable, and a defensive fallback is cheaper than widening every consumer's type for a case that can't occur."
  - "Conversation history renders inline in page.tsx rather than as a fourth component file — the plan's files_modified list only names audit-list.tsx as a separate component, and the section is short enough not to need its own file."

requirements-completed: [SEG-11, SIS-01, SEG-10, SEG-06]

duration: ~35min
completed: 2026-09-14
---

# Phase 4 Plan 11: Bitácora visible Summary

Made SEG-11's "bitácora completa y visible para el equipo" real: `/dashboard/bitacora` now renders the pending approval queue with working approve/reject buttons, the full agent action log, and the team's conversation history, with every row's visibility decided entirely by the RLS policies from 04-01/04-03 — no role or client filter exists anywhere in the new reader or page code.

## Performance

- **Duration:** ~35 min
- **Tasks:** 2/2 completed
- **Files modified:** 8 (5 created, 3 modified)

## Accomplishments

- `lib/audit/list-audit-log.ts` and `lib/agent/list-approvals.ts`: four RLS-scoped readers (`listAuditLog`, `listRecentConversationMessages`, `listPendingApprovals`, `listRecentDecidedApprovals`), each opening its own `withTenantContext` transaction with no `client_id` predicate and no `app.role` branch — the exact LD-17 shape the plan required.
- `/dashboard/bitacora`: three sections (pending approvals, action log, conversation history) in one Server Component page, using the same provisioning-fallback pattern as `team/page.tsx` and `chat/page.tsx`.
- `ApprovalRow` (client component): calls `approveAction`/`rejectAction`, renders `{ ok: false, error }` inline without optimistically removing the row (the Server Action's own `revalidatePath` is what refreshes the list).
- `AuditList`: plain Server Component with risk/status badges, kept separate from `page.tsx` for readability.
- Dashboard nav gained a `Bitacora` link after `Chat`; both `messages/es.json` and `messages/en.json` gained a full, structurally identical `Bitacora` namespace.

## Task Commits

1. **Task 1: RLS-scoped readers for audit, approvals and conversations** - `943dc90` (feat)
2. **Task 2: /dashboard/bitacora page with working approve and reject** - `8e98377` (feat)

**Plan metadata:** committed separately by the orchestrator (worktree mode — this agent does not touch STATE.md/ROADMAP.md).

## Files Created/Modified

- `lib/audit/list-audit-log.ts` - `listAuditLog` (audit_log LEFT JOIN agent_action_catalog, clients) and `listRecentConversationMessages` (messages LEFT JOIN clients), both RLS-only scoped
- `lib/agent/list-approvals.ts` - `listPendingApprovals` (status = 'pending') and `listRecentDecidedApprovals` (status <> 'pending'), both RLS-only scoped
- `app/[locale]/dashboard/bitacora/page.tsx` - the three-section bitácora Server Component, no admin gating
- `app/[locale]/dashboard/bitacora/approval-row.tsx` - client component wiring `approveAction`/`rejectAction` with inline error rendering
- `app/[locale]/dashboard/bitacora/audit-list.tsx` - plain Server Component rendering the action log with risk/status badges
- `app/[locale]/dashboard/layout.tsx` - added the `/dashboard/bitacora` nav link after `/dashboard/chat`
- `messages/es.json` / `messages/en.json` - added `Dashboard.nav.bitacora` and the full `Bitacora` namespace

## Decisions Made

- Fell back to the raw `action_type_code` when the LEFT-JOINed `agent_action_catalog.label` is `null` at the type level, since Drizzle can't express "this LEFT JOIN always matches" — the FK is `NOT NULL` against a static, row-locked, three-row catalog, so the fallback branch is defensive, not an expected runtime path.
- Rendered the conversation-history section inline in `page.tsx` rather than as a fourth file, since the plan's `files_modified` list only calls out `audit-list.tsx` as a separate component and the section is short.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `actionLabel`/`AuditEntry`/`PendingApproval`/`DecidedApproval` typed as non-nullable `string` did not type-check against Drizzle's LEFT JOIN result**
- **Found during:** Task 1 (`npx tsc --noEmit` after writing both reader files)
- **Issue:** The plan's own interface for `AuditEntry`/`PendingApproval`/`DecidedApproval` types `actionLabel: string` (never null), but a Drizzle `leftJoin` on `agent_action_catalog` types the joined `label` column as `string | null` regardless of the underlying FK's `NOT NULL` constraint — Drizzle's type system can't see through a LEFT JOIN to the FK's own nullability guarantee.
- **Fix:** Selected `actionTypeCode` alongside the joined `actionLabel` in each query, then mapped the raw rows to the public return type with `actionLabel: actionLabel ?? actionTypeCode` — falls back to the raw code only in the (FK-impossible) case the join finds no match, satisfying the plan's non-nullable interface without lying about what Drizzle actually returns.
- **Files modified:** `lib/audit/list-audit-log.ts`, `lib/agent/list-approvals.ts`
- **Commit:** `943dc90`

**2. [Rule 3 - Blocking] `node_modules` was not installed in this worktree**
- **Found during:** Task 2's `npm run build` acceptance check
- **Issue:** This git worktree had no `node_modules` at all — `tsc`/`eslint` had worked only because `npx` resolved those binaries from the parent repo's `node_modules` up the directory tree, but Turbopack's own hermetic build resolution does not do that walk and failed with "Could not find the Next.js package."
- **Fix:** Ran `npm install` (657 packages, matches `package-lock.json` — same count 04-10's SUMMARY records for the same fix).
- **Files modified:** None (dependency install only, no lockfile drift).

**3. [Rule 3 - Blocking] `npm run build` needed environment variables that don't exist in a fresh worktree**
- **Found during:** Task 2's `npm run build` acceptance check
- **Issue:** No `.env.local` existed. `next build`'s page-data collection evaluates every route's module graph, including modules that throw synchronously at import time if `DATABASE_URL` (and other required vars) are unset — same class of gap 04-10's SUMMARY documents for its own build run.
- **Fix:** Created a git-ignored `.env.local` with placeholder values for every variable `.env.example` lists — confirmed gitignored (`.gitignore:34:.env*`) before and after, never staged.
- **Files modified:** None tracked (untracked, gitignored `.env.local` only).

## Known Stubs

None — every reader wired to a real query, every button wired to a real Server Action, no hardcoded/mock data anywhere on this page.

## Verification Performed

- `npx tsc --noEmit` — exits 0, after each task.
- `npm run lint` — exits 0.
- `npm run build` — exits 0; `/dashboard/bitacora` appears in the route list.
- `npm run verify:agent-prompt` — 10/10 assertions pass, no regression.
- `npm run verify:agent-media` — 9/9 assertions pass, no regression.
- All plan `<acceptance_criteria>` grep/node checks for both tasks pass, including: `withTenantContext(` count = 2 in each reader file, no `clientAssignments`/`app.role` GUC reference in reader code, `audit_log` read from exactly one module, `"use client"` present in `approval-row.tsx` and absent from `page.tsx`, `approveAction`/`rejectAction` referenced, `nav.bitacora`/`nav.chat`/`nav.team`/`nav.branding` all present in `layout.tsx`, `Bitacora` i18n namespace structurally identical between `es.json`/`en.json`, no `role === "admin"` conditional on the page.
- `git status --short` after each commit — clean, no unexpected untracked or deleted files.

## Self-Check: PASSED

- FOUND: `lib/audit/list-audit-log.ts`
- FOUND: `lib/agent/list-approvals.ts`
- FOUND: `app/[locale]/dashboard/bitacora/page.tsx`
- FOUND: `app/[locale]/dashboard/bitacora/approval-row.tsx`
- FOUND: `app/[locale]/dashboard/bitacora/audit-list.tsx`
- FOUND commit `943dc90` in `git log --oneline`
- FOUND commit `8e98377` in `git log --oneline`
