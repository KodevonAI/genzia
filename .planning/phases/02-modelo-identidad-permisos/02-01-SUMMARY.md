---
phase: 02-modelo-identidad-permisos
plan: 01
subsystem: identity
tags: [typescript, discriminated-union, pure-function, unit-testing, tsx]

# Dependency graph
requires:
  - phase: 01-fundaciones-cuenta-equipo
    provides: team_members schema/role convention, invite-member.ts discriminated-union style, current-member.ts pure-lookup-over-fetched-row style, verify-rls-isolation.ts check()/assertion-helper convention
provides:
  - ResolvedIdentity discriminated union (team_member | client_contact | unknown) as the identity contract for all of Phase 2
  - classifyIdentity: pure, network-free classification core with documented team-wins precedence
  - AI_DISCLOSURE_RULE / AI_DISCLOSURE_REQUIREMENT_ID: SEG-09 single source of truth for Phase 3/4 prompts
  - scripts/verify-identity-classification.ts + npm run verify:identity-classification: sandbox-safe (no Neon egress) proof of all classifyIdentity branches
affects: [02-04-identity-resolution, 02-06-identity-resolution-consumers, phase-03-agent, phase-04-agent]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure decision core separated from I/O: classifyIdentity takes already-fetched row shapes and returns a typed union, with zero DB/network imports, enabling network-free unit testing"
    - "Single-source-of-truth constant for cross-phase behavioral rules (AI_DISCLOSURE_RULE) instead of re-derived prompt text per call site"

key-files:
  created:
    - lib/identity/types.ts
    - lib/identity/classify-identity.ts
    - lib/identity/disclosure.ts
    - scripts/verify-identity-classification.ts
  modified:
    - package.json

key-decisions:
  - "classifyIdentity precedence: team_members match wins over authorized_contacts match when both are somehow present (DB trigger in 02-03 is the real prevention; this function stays deterministic regardless)"
  - "Reworded plan's prescribed doc-comment text in classify-identity.ts and verify-identity-classification.ts to avoid literal substrings (\"await\", \"drizzle-orm\", \"lib/db\", \"lib/tenant\") that the plan's own acceptance-criteria greps checked for zero occurrences of — the plan's exact <action> code block was self-contradictory with its own <acceptance_criteria> greps"

patterns-established:
  - "lib/identity/ as the home for pure identity-contract types and logic, separate from lib/tenant/ (GUC-setting) and future lib/identity/resolve-identity.ts (DB orchestration)"
  - "Network-free test scripts under scripts/ that import only pure logic modules, runnable in sandboxed sessions with no Neon egress, alongside DB-backed scripts/verify-*.ts counterparts"

requirements-completed: [SEG-01, SEG-09]

# Metrics
duration: 15min
completed: 2026-09-08
---

# Phase 2 Plan 01: Identity Contract (types + pure classifier + disclosure rule + Wave-0 tests) Summary

**Pure `classifyIdentity` function plus `ResolvedIdentity` discriminated union and SEG-09 disclosure constant, proven by a 7-assertion network-free test suite runnable with zero Neon egress**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-09-08T21:04:00Z (approx, session start)
- **Completed:** 2026-09-08T21:11:00Z
- **Tasks:** 3/3 completed
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments
- `ResolvedIdentity` discriminated union with exactly three variants (`team_member`, `client_contact`, `unknown`) established as the single identity contract for Phase 2
- `classifyIdentity` — pure, synchronous, zero I/O — implements documented team-wins precedence and covers all ROADMAP-required cases
- `AI_DISCLOSURE_RULE` constant created as the SEG-09 single source of truth for Phase 3/4 agent prompts
- `scripts/verify-identity-classification.ts` — 7/7 assertions passing, zero network access, zero imports from `lib/db`/`lib/tenant`/`drizzle-orm`

## Task Commits

Each task was committed atomically:

1. **Task 1: Define ResolvedIdentity types and the pure classifyIdentity core** - `f85d3ee` (feat)
2. **Task 2: Add the SEG-09 AI-disclosure rule constant** - `ad793ac` (feat)
3. **Task 3: Wave-0 unit test script for classifyIdentity + npm script** - `454b791` (test)

**Plan metadata:** (pending — this SUMMARY.md commit)

## Files Created/Modified
- `lib/identity/types.ts` - `ResolvedIdentity` discriminated union, `TeamMemberIdentityRow`, `AuthorizedContactIdentityRow`
- `lib/identity/classify-identity.ts` - pure `classifyIdentity(teamMemberRow, contactRow)` function, team-wins precedence
- `lib/identity/disclosure.ts` - `AI_DISCLOSURE_RULE` and `AI_DISCLOSURE_REQUIREMENT_ID` (SEG-09)
- `scripts/verify-identity-classification.ts` - 7 network-free assertions covering all classifyIdentity branches plus precedence and cross-client-distinctness guards
- `package.json` - added `verify:identity-classification` npm script

## Decisions Made
- Followed the plan's prescribed code verbatim for logic and types (no deviation from the actual contract/behavior).
- Reworded two doc comments (in `classify-identity.ts` and `verify-identity-classification.ts`) that, as literally specified in the plan's `<action>` blocks, contained the exact substrings ("awaits", "drizzle-orm", "lib/db", "lib/tenant") that the plan's own `<acceptance_criteria>` greps required to be absent (count 0). This was a self-contradiction in the plan text itself — the explanatory prose describing what the code does NOT do triggered the same regex meant to prove it doesn't do those things. Rewording preserves the exact same explanatory intent using non-matching phrasing (e.g. "the ORM layer" instead of "drizzle-orm", "zero async operations" instead of "zero awaits").

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reworded doc comment in lib/identity/classify-identity.ts to unblock its own acceptance criteria**
- **Found during:** Task 1
- **Issue:** The plan's exact `<action>` code for the file header comment contains "Zero I/O, zero awaits, zero imports from `drizzle-orm`, `lib/db/*` or `lib/tenant/*`" — but the plan's own `<acceptance_criteria>` for this same task require `grep -c 'await' ...` and `grep -c "drizzle-orm\|lib/db\|lib/tenant" ...` to both return 0. Copying the prescribed comment verbatim would fail its own acceptance check.
- **Fix:** Reworded the comment to preserve the identical explanatory meaning ("Zero I/O, fully synchronous, no imports from the ORM layer, the database module, or the tenant-context module") without the literal substrings the grep checks for.
- **Files modified:** lib/identity/classify-identity.ts
- **Verification:** `grep -c 'await' lib/identity/classify-identity.ts` → 0; `grep -c "drizzle-orm\|lib/db\|lib/tenant" lib/identity/classify-identity.ts` → 0; `npx tsc --noEmit` exits 0
- **Committed in:** f85d3ee (Task 1 commit)

**2. [Rule 3 - Blocking] Reworded doc comment in scripts/verify-identity-classification.ts for the same reason**
- **Found during:** Task 3
- **Issue:** The plan's exact `<action>` code for the file header comment says "Deliberately imports nothing from `lib/db`, `lib/tenant` or `drizzle-orm`" — but the plan's own `<acceptance_criteria>` require `grep -c "lib/db\|lib/tenant\|drizzle-orm\|@neondatabase" scripts/verify-identity-classification.ts` to return 0.
- **Fix:** Reworded to "Deliberately imports nothing from the database module, the tenant-context module, or the ORM layer" — same meaning, no literal substring match.
- **Files modified:** scripts/verify-identity-classification.ts
- **Verification:** `grep -c "lib/db\|lib/tenant\|drizzle-orm\|@neondatabase" scripts/verify-identity-classification.ts` → 0; script still runs 7/7 PASS after the edit
- **Committed in:** 454b791 (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking, self-contradictory acceptance criteria in the plan's own prescribed text)
**Impact on plan:** Purely cosmetic wording fixes in doc comments; no change to any executable logic, type, or test assertion. No scope creep.

## Issues Encountered
- The worktree had no `node_modules` (git worktrees don't share installed dependencies). Symlinked `node_modules` from the main checkout (`/Users/sebastian/Documents/kodevon/Proyectos/genzia/node_modules`) rather than running a fresh `npm install`, to avoid version drift and unnecessary network use. The symlink is gitignored (`node_modules` is in `.gitignore`) and was not committed.

## User Setup Required

None - no external service configuration required. This plan is 100% pure TypeScript with no database or network dependency, verified to run green with zero Neon egress.

## Next Phase Readiness

- `lib/identity/types.ts` and `lib/identity/classify-identity.ts` export the exact interface names (`ResolvedIdentity`, `classifyIdentity`, `TeamMemberIdentityRow`, `AuthorizedContactIdentityRow`) that downstream plans 02-04 (`lib/identity/resolve-identity.ts`) and 02-06 consume — do not rename without updating those plans.
- `AI_DISCLOSURE_RULE` is ready for Phase 3/4 to inject verbatim into agent system prompts; no wiring done in this phase since no agent/prompt exists yet.
- No blockers. Wave 1 of Phase 2 plans that depend on nothing else can proceed; Wave 4 (`02-07`) still requires real Neon network access per STATE.md's documented sandbox gate.

---
*Phase: 02-modelo-identidad-permisos*
*Completed: 2026-09-08*

## Self-Check: PASSED

All created files confirmed present: `lib/identity/types.ts`, `lib/identity/classify-identity.ts`,
`lib/identity/disclosure.ts`, `scripts/verify-identity-classification.ts`,
`.planning/phases/02-modelo-identidad-permisos/02-01-SUMMARY.md`.

All task commits confirmed in `git log`: `f85d3ee`, `ad793ac`, `454b791`.
