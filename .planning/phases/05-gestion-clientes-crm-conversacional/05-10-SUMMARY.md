---
phase: 05-gestion-clientes-crm-conversacional
plan: 10
subsystem: database, api, ui
tags: [postgres-rls, security-definer, agent-tools, human-verify]

# Dependency graph
requires:
  - phase: 05-gestion-clientes-crm-conversacional
    provides: "05-01 through 05-09: schema, RLS split, interceptor fix, data layer, agent tools, web surfaces, verify suite, D-18 cleanup"
provides:
  - "Migrations 0020-0023 live on real Neon"
  - "Real-Postgres proof that the RLS write-policy split and interceptor fix actually work, not just typecheck"
  - "Two human-verified checkpoints: end-to-end dictation (create/ask-back/duplicate/edit/search) and ficha visual layering"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: ["SECURITY DEFINER + pinned search_path escape hatch for a trigger whose own internal SELECT would otherwise be scoped by the caller's RLS context"]

key-files:
  created:
    - drizzle/migrations/0023_client_assignments_check_security_definer.sql
  modified:
    - scripts/verify-rls-isolation.ts
    - scripts/verify-agent-rls.ts
    - scripts/verify-agent.ts
    - scripts/verify-whatsapp-webhook.ts
    - scripts/verify-identity-resolution.ts
    - scripts/verify-clients-crm.ts
    - lib/clients/create-client.ts
    - lib/agent/tools/list-clients.ts
    - drizzle/migrations/meta/_journal.json

key-decisions:
  - "Migration 0023 (new, not an edit to 0004) makes client_assignments_agency_consistency() SECURITY DEFINER — 0004 already shipped to production, editing it in place would silently diverge from what's already applied"
  - "createClient() now generates the client id in application code (randomUUID()) and skips .returning() entirely, rather than working around the RLS-on-RETURNING gotcha with a follow-up SELECT — fewer round trips, same guarantee"
  - "list_clients now returns each client's id in its output text (not just name/phone/industry) so the agent can chain into get_client/update_client by name — this was a hard blocker for D-10, found live during the human checkpoint, not by an automated suite"
  - "Task 2's checkpoint was executed directly by the assistant (yolo-mode config.json + Claude-in-Chrome), not a separate human sign-off — same posture 03-08-SUMMARY.md recorded for its own real-Neon checkpoint. A temporary team member and two duplicate-named test clients were created live during this run and deleted (DB rows + Clerk users) once all five confirmations were captured"

patterns-established:
  - "A trigger function that does its own integrity SELECT against a table gated by RLS must be SECURITY DEFINER + SET search_path, same as any cross-agency SECURITY DEFINER lookup — invoker-security is only safe as long as every writer already has unrestricted SELECT on the referenced rows, and D-13's self-assign-on-create path broke that assumption for the first time in this codebase"

requirements-completed: [CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, SEG-08]

# Metrics
duration: ~2.5h
completed: 2026-09-15
---

# Phase 5: Gestión Clientes CRM Conversacional — Wave 6 (05-10) Summary

**Migrations 0020-0023 applied to real Neon; all six verify suites green with exact counts; three real production bugs found and fixed along the way (RLS-on-RETURNING, a SECURITY DEFINER gap in a Phase-2 trigger, and a missing `id` in `list_clients` that made dictated edits unreachable); both human-verify checkpoints (dictation end-to-end, ficha visual layering) confirmed directly against the running app.**

## Performance

- **Tasks:** 3 of 3 completed (Task 1 auto; Tasks 2/3 human-verify, executed directly per yolo-mode posture)
- **Files modified:** 9 (1 new migration, 8 existing files touched)

## Accomplishments

### Task 1 — Real-Neon proof

- Migrations `0020_clients_crm_fields`, `0021_clients_write_by_team_member`, `0022_agent_action_catalog_client` applied via `npm run db:migrate` (owner-role `DATABASE_URL` from Neon Console — `.env`'s `DATABASE_URL` is `app_user`, no DDL rights).
- Full suite matrix run against real Postgres, exact counts:
  - `db:verify-rls` — 7/7
  - `db:verify-identity` — 16/18 (only the two known SEG-12 failures, 8b/8c — no regression)
  - `db:verify-whatsapp` — 28/28
  - `db:verify-agent-rls` — fully green
  - `db:verify-agent` — fully green
  - `db:verify-clients-crm` (this phase's own gate) — 21/21, zero failures
- Residue check: `select count(*) from agencies where id like 'verify-%'` → 0 after every run.

### Task 2 — Dictation checkpoint (5/5 confirmed)

Executed live against the running dev app as a real non-admin member (`member0510b+clerk_test@genzia-verify.dev`, Clerk `+clerk_test` test account, self-signed-up via the app's own invite flow — no direct DB writes to create the login):

1. **Ask-back (D-07):** "Dame de alta un cliente nuevo llamado Panadería Sol" (no contact info) → agent asked for phone/email, created nothing yet.
2. **Self-assignment (D-13):** after providing a phone, `/dashboard/clients` showed "Panadería Sol" to this member with zero prior admin-granted assignment.
3. **Duplicate-name (D-09):** a second "Panadería Sol" (different phone) was created *and* flagged in the same reply ("ya existe otro cliente llamado…") — soft confirmation, not silent, not a hard block.
4. **Dictated edit (D-10):** "Actualiza las notas de Panadería Sol (la del teléfono …)" — see Issue #3 below; after the `list_clients` fix, the agent resolved the client by name, called `update_client` with the real id, and the ficha showed the notes updated with phone/assignment unchanged (merge, not replace).
5. **Search (D-11/D-12):** "Buscá clientes de panadería" returned both clients this member has access to, each formatted `Name (industry) — contact [id: uuid]`.

### Task 3 — Ficha visual checkpoint (5/5 confirmed)

Verified as admin (Google OAuth, existing session) and cross-checked as the non-admin member:

1. Notes box has a lock icon, "Solo el equipo puede ver esto." caption, and its own bordered box.
2. Pagos/Próximas citas render as populated-weight empty-state boxes ("Todavía no hay pagos que mostrar aquí." / "Todavía no hay citas agendadas."), not blank space.
3. "Reasignar" expands inline (no navigation, no modal) into a checkbox list of every team member; visible to admin only — the member's own view of the same ficha showed no such control at all.
4. `/dashboard/team/[memberId]` has no quick-add text input — only a "Nuevo cliente" link that opens the real `/dashboard/clients/new` form (name/phone/email/industry/notes).
5. `/dashboard/clients` search narrows live (URL updates via client-side routing, no submit button) with a distinct "Sin resultados para…" empty state vs. "Todavía no tienes clientes." for zero clients overall.

## Task Commits

1. **Fix verify-script fixtures for the new contact-required constraint** - `7cccf90` (fix)
2. **Fix LD-06 stale tool-count assertion (2 → 6)** - `4d09db5` (fix)
3. **Fix createClient's INSERT...RETURNING RLS gotcha** - `69a12e5` (fix)
4. **Migration 0023: SECURITY DEFINER on client_assignments_agency_consistency()** - `846e6f2` (fix)
5. **Fix verify-clients-crm's D-09 assertion to use an RLS-visible duplicate scenario** - `246eb29` (fix)
6. **Expose client id from list_clients** - `590a283` (fix)

## Deviations from Plan

### Auto-fixed Issues (Rule 1)

**1. [Bug] Verify-script client fixtures broke on the new contact-required constraint**
- **Found during:** first `db:verify-rls` run against real Neon, post-migration.
- **Issue:** every prior phase's verify script seeded test clients with `name` only. Migration 0020's `clients_contact_required_check` (added this phase) now rejects that.
- **Fix:** gave every fixture across 5 scripts a phone number. The constraint itself is correct and was not weakened.
- **Committed in:** `7cccf90`

**2. [Bug] `db:verify-agent`'s LD-06 assertion hardcoded the pre-Phase-5 tool count**
- **Found during:** re-run after fix #1.
- **Issue:** `AGENT_TOOLS` correctly grew from 2 to 6 (05-04); the test's own expectation didn't.
- **Fix:** updated the assertion to expect 6. No code change needed elsewhere.
- **Committed in:** `4d09db5`

**3. [Bug] `createClient()`'s `INSERT ... RETURNING` violated RLS for a self-assigning member**
- **Found during:** `db:verify-clients-crm`'s assertion (1), which calls the real `createClient()`.
- **Issue:** Postgres re-checks `INSERT ... RETURNING` against the table's SELECT policy, not just the INSERT policy's `WITH CHECK`. A plain member creating a brand-new client has no `client_assignments` row for it yet (that insert happens immediately after) and isn't admin, so `clients_select_by_role` denied the RETURNING clause specifically — this would have broken D-13 (any member can create a client) for every non-admin member in production, including this phase's own dictation checkpoint.
- **Fix:** `insertClientRow` now generates the id with `randomUUID()` and inserts without `.returning()` — nothing needs to be read back since the id is already known.
- **Committed in:** `69a12e5`

**4. [Bug] `client_assignments_agency_consistency()` (migration 0004, Phase 2) failed the same way, one step later**
- **Found during:** `db:verify-clients-crm`, immediately after fix #3.
- **Issue:** the trigger's own internal `SELECT 1 FROM clients WHERE …` runs as INVOKER, so it's *also* scoped by `clients_select_by_role`. A member self-assigning to a client they just created can't see it yet (same chicken-and-egg), so the trigger's existence check found nothing and raised a false "agency mismatch" on data that was actually fully consistent. Every writer before Phase 5 was either an admin or already had the row visible some other way, so this never surfaced until D-13.
- **Fix:** new migration `0023` makes the trigger function `SECURITY DEFINER` with a pinned `search_path` — the same escape hatch `0013`'s `find_agency_by_team_whatsapp_number` already uses for an analogous problem.
- **Committed in:** `846e6f2`

**5. [Bug] `verify-clients-crm.ts`'s D-09 assertion (19) tested a scenario the design doesn't support**
- **Found during:** re-run after fix #4 — assertion (19) failed because `memberOther` got no duplicate warning for a name matching admin-seeded "Client A".
- **Issue:** 05-RESEARCH.md's own "Duplicate-name detection (D-09)" entry explicitly scopes the check to the caller's own RLS-visible rows, not agency-wide. The test had `memberOther` (unassigned to "Client A") try to trigger the warning — correctly impossible by design, since they can't see that client at all. This was the test's bug, not the code's — service-layer assertions (7)/(8) already proved the real same-actor case.
- **Fix:** replaced with (19a)/(19b): memberOther creates a client via the tool, then creates a second one with the same name, proving the relay against a name they can actually see.
- **Committed in:** `246eb29`

**6. [Bug, found during Task 2's live human checkpoint, not the automated suite] `list_clients` never returned a client's `id`**
- **Found during:** the actual dictation checkpoint — asked the agent to update "Panadería Sol"'s notes by name; it correctly refused to guess a `clientId` (no hallucination) and explained that `list_clients`'s output only ever had name/phone/industry, never the UUID `update_client`/`get_client` require.
- **Issue:** every "find a client by name, then act on it" conversational flow — D-10's whole premise — was structurally unreachable unless the human already knew the client's internal UUID, which they never do in practice. The automated suite's assertions (13)/(14)/(15)/(16) all pass a `clientId` directly and never exercised this chain, so it slipped through Wave 4 unnoticed.
- **Fix:** `list_clients` now selects `id` and appends `[id: ...]` to each result line; its tool description tells the model to use it for follow-up `get_client`/`update_client` calls. No RLS change — same `clients_select_by_role`-scoped rows, one more column.
- **Committed in:** `590a283`
- **Re-verified:** re-ran the dictation checkpoint's step 4 in a fresh conversation after the fix — the agent found the id and completed the edit correctly (confirmed on the ficha: notes updated, phone/assignment unchanged).

**Total deviations:** 6 auto-fixed (Rule 1) — 3 real production bugs (RETURNING/RLS, SECURITY DEFINER gap, missing id in list_clients) and 3 stale/incorrect test assertions.

## Files Created/Modified

- `drizzle/migrations/0023_client_assignments_check_security_definer.sql` - new: SECURITY DEFINER fix for the Phase-2 consistency trigger
- `lib/clients/create-client.ts` - `insertClientRow` generates its own id, drops `.returning()`
- `lib/agent/tools/list-clients.ts` - selects and returns `id`, updated tool description
- `scripts/verify-rls-isolation.ts`, `verify-agent-rls.ts`, `verify-agent.ts`, `verify-whatsapp-webhook.ts`, `verify-identity-resolution.ts` - fixture phone numbers
- `scripts/verify-clients-crm.ts` - assertion (1) calls real `createClient()`; assertions (19a)/(19b) replace the mis-scoped (19)
- `drizzle/migrations/meta/_journal.json` - registers 0023

## Issues Encountered

None beyond the six deviations above, all resolved within this plan's own execution per Rule 1 — no open gaps carried forward.

## User Setup Required

Nothing further. The owner-role `DATABASE_URL` used for migrations came from Neon Console's connection dialog for this run only and was never written to any file. Test data (one Clerk test user, two duplicate-named clients, plus one additional stray invited-but-unactivated test account from an earlier `+clerk_test` misstep) was deleted from both Postgres and Clerk before closing this plan — the "Genzia" agency is back to 0 clients / 1 team member (the real admin).

---
*Phase: 05-gestion-clientes-crm-conversacional*
*Completed: 2026-09-15*
