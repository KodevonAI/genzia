---
phase: 01-fundaciones-cuenta-equipo
plan: 04
type: execute
wave: 3
depends_on: ["01", "02"]
files_modified:
  - lib/team/invite-member.ts
  - lib/team/list-members.ts
  - app/api/webhooks/clerk/route.ts
  - drizzle/migrations/0003_client_assignments_check.sql
  - app/[locale]/(dashboard)/team/page.tsx
  - app/[locale]/(dashboard)/team/invite-form.tsx
  - app/[locale]/(dashboard)/team/member-row.tsx
  - lib/clients/list-clients.ts
  - lib/clients/assign-client.ts
  - app/[locale]/(dashboard)/team/[memberId]/page.tsx
  - app/[locale]/(dashboard)/team/[memberId]/assign-clients-form.tsx
  - messages/es.json
  - messages/en.json
autonomous: true
user_setup:
  - service: clerk
    why: "Team invitations use Clerk's organization invitation system, carrying role + WhatsApp number as invitation metadata"
    dashboard_config:
      - task: "Subscribe the existing webhook endpoint (from Plan 02) to organizationInvitation.accepted and organizationMembership.created as well"
        location: "Clerk Dashboard -> Webhooks -> (the endpoint from Plan 02) -> edit subscribed events"
must_haves:
  truths:
    - "An admin can invite someone by email, choosing their role (admin/member) and capturing their WhatsApp number, in one step at invite time."
    - "Once the invitee accepts, they can sign in and see exactly the dashboard their role permits — admins see every client, members see only clients assigned to them."
    - "An admin can assign specific clients to a member, and that member's visible client list changes immediately to match — nothing more, nothing less."
    - "A member who removes/loses an assignment immediately loses access to that client's data, not just its listing in the UI."
    - "Inviting, changing roles, and assigning clients are admin-only actions — a member cannot do any of them, even by calling the server action directly."
  artifacts:
    - "lib/team/invite-member.ts — creates the Clerk org invitation carrying role+whatsapp_number, and the corresponding team_members row (status invited)"
    - "app/api/webhooks/clerk/route.ts (extended) — organizationInvitation.accepted / organizationMembership.created transition team_members from invited to active and set clerk_user_id"
    - "app/[locale]/(dashboard)/team — roster page (CTA-04/CTA-05) plus per-member client assignment page (CTA-06)"
    - "lib/clients/assign-client.ts — writes client_assignments, admin-only, RLS-backed"
  key_links:
    - "Invite form submit -> Clerk createOrganizationInvitation(role+whatsapp in publicMetadata) -> team_members row (status='invited') — if the metadata isn't carried through, the invited member has no WhatsApp number captured at all, silently breaking WA-04's identity-resolution prerequisite for Phase 3."
    - "organizationMembership.created webhook -> team_members.clerk_user_id backfilled + status='active' — this is the row withTenantContext (Plan 01) looks up on every request; if this transition is missed, an accepted invitee is authenticated with Clerk but has no team_member row and every tenant-scoped page breaks for them."
    - "client_assignments write -> clients RLS SELECT policy (Plan 01) re-evaluated on the member's very next query — the assignment UI is a thin layer over a DB-enforced boundary, not the boundary itself; verify the RLS side, not just that the UI list looks right."
---

<objective>
Let an agency admin build out their team with the right roles and WhatsApp
numbers (CTA-04, CTA-05), and control exactly which clients each member can see
(CTA-06) — the phase's headline success criterion ("invita a 2+ miembros con
roles distintos, y cada quien ve solo lo que su rol permite") is proven here.

Purpose: this is the last piece of Fase 1's functional scope. It also lays the
literal groundwork for Fase 2's SEG-01/SEG-06/SEG-07 (identity resolution by
role/assignment) — the `team_members.whatsapp_number` and `client_assignments`
tables this plan populates are exactly what that phase's resolver reads.

Output: working invite flow (role + WhatsApp number captured at invite time),
role-aware dashboard access, and a client-assignment UI backed by Plan 01's RLS
policies — not just filtered-in-the-UI, actually unreadable at the DB layer for
an unassigned member.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/STACK.md
@.planning/research/STACK-WEB.md
@.planning/phases/01-fundaciones-cuenta-equipo/01-fundaciones-cuenta-equipo-01-SUMMARY.md
@.planning/phases/01-fundaciones-cuenta-equipo/01-fundaciones-cuenta-equipo-02-SUMMARY.md
@lib/tenant/with-tenant-context.ts
@lib/db/schema/team-members.ts
@lib/db/schema/client-assignments.ts
@app/api/webhooks/clerk/route.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Invite flow — Clerk invitation carrying role + WhatsApp number, synced to team_members</name>
  <files>lib/team/invite-member.ts, lib/team/list-members.ts, app/api/webhooks/clerk/route.ts, app/[locale]/(dashboard)/team/page.tsx, app/[locale]/(dashboard)/team/invite-form.tsx, app/[locale]/(dashboard)/team/member-row.tsx, messages/es.json, messages/en.json</files>
  <action>
    Implement `lib/team/invite-member.ts` (Server Action, `withTenantContext`,
    admin-only — reject non-admins server-side): validates `{email, role,
    whatsappNumber}` (role in `admin|member`; a light phone-format check on
    whatsappNumber, E.164-ish — full validation isn't critical here since
    Phase 3 is where it actually gets used against Meta's API), calls Clerk's
    backend SDK `clerkClient.organizations.createOrganizationInvitation({
    organizationId: agencyId, emailAddress: email, role: <clerk role mapped
    from admin/member>, publicMetadata: { role, whatsappNumber } })`, then
    inserts a `team_members` row with `status='invited'`, the given role,
    email, and whatsapp_number (so the roster shows pending invites
    immediately, before acceptance). Guard against duplicate invites (unique
    `(agency_id, email)` index from Plan 01 — catch the constraint violation
    and surface a clear "already invited" error instead of a raw DB error).

    Extend `app/api/webhooks/clerk/route.ts` (from Plan 02) with two more
    cases in the event switch: `organizationInvitation.accepted` and/or
    `organizationMembership.created` (handle whichever actually fires with the
    data needed — confirm via the Clerk Dashboard test-event payloads; at
    minimum `organizationMembership.created` reliably carries both `orgId` and
    the joining `userId`) — look up the existing `team_members` row by
    `(agency_id, email)`, set `clerk_user_id` and `status='active'`,
    `joined_at=now()`. If no matching invited row is found (edge case: someone
    joins the org outside this flow), log it rather than silently no-op-ing —
    this must not be a way to bypass invite-time role/whatsapp capture. Keep
    this idempotent like Task 1 of Plan 02.

    Implement `lib/team/list-members.ts` (`withTenantContext`, any team member
    can call this — the roster itself isn't admin-only to view, only to
    mutate) returning all `team_members` for the agency. Build
    `app/[locale]/(dashboard)/team/page.tsx` (roster: name/email, role badge,
    status invited/active, WhatsApp number, link to the assignment page from
    Task 2) and `invite-form.tsx` (admin-only — hide/disable the form entirely
    for non-admin viewers, in addition to the server-side check) with
    email/role/whatsapp fields. Add the link into Plan 02's dashboard nav slot.
    Add new copy to both message files.
  </action>
  <verify>As an admin, invite a second real/test email with role "member" and a WhatsApp number — roster shows it as "invited" immediately. Accept the invite (via the emailed link, or Clerk's dev flow) as that user, sign in — webhook fires, roster now shows "active", and `team_members.clerk_user_id`/`whatsapp_number`/`role` are all correctly populated. Attempt to call `invite-member` as the non-admin member — rejected.</verify>
  <done>CTA-04 and CTA-05 work end to end: admin invites with role+WhatsApp captured at invite time, invitee acceptance correctly activates their team_members row with all captured fields intact, and invite/role changes are provably admin-only.</done>
</task>

<task type="auto">
  <name>Task 2: Per-member client assignment (CTA-06), backed by Plan 01's RLS</name>
  <files>lib/clients/list-clients.ts, lib/clients/assign-client.ts, drizzle/migrations/0003_client_assignments_check.sql, app/[locale]/(dashboard)/team/[memberId]/page.tsx, app/[locale]/(dashboard)/team/[memberId]/assign-clients-form.tsx, messages/es.json, messages/en.json</files>
  <action>
    Implement `lib/clients/list-clients.ts` (`withTenantContext`) returning
    all `clients` rows visible to the caller — for an admin this is the whole
    agency roster (RLS lets it through); for a member it's already naturally
    limited to their assigned clients by Plan 01's RLS policy, so this
    function needs no manual filtering logic — trust the database, don't
    duplicate the check in application code (that duplication is exactly the
    anti-pattern STACK-WEB.md §2 warns against). Note: since `clients` is only
    a stub table in this phase (Plan 01 Task 2 — id/agency_id/name), also add
    a minimal admin-only "add client" inline action here if the roster is
    otherwise empty to assign against (a bare `name` field, inserting into
    `clients` — full CRM intake is Phase 5's CLI-01, this is only enough to
    exercise CTA-06 meaningfully in this phase).

    Implement `lib/clients/assign-client.ts` (`withTenantContext`,
    admin-only): `assignClient(clientId, teamMemberId)` inserts into
    `client_assignments` (agency_id from context, ON CONFLICT DO NOTHING —
    idempotent re-assignment) and `unassignClient(clientId, teamMemberId)`
    deletes the matching row. If useful for defense-in-depth, add
    `drizzle/migrations/0003_client_assignments_check.sql` with a trigger or
    check ensuring `client_assignments.agency_id` always matches both the
    referenced `clients.agency_id` and `team_members.agency_id` (belt-and-
    suspenders against a bug that assigns a client from one agency to a member
    of another — RLS already prevents the read side, this closes the write
    side at the constraint level too).

    Build `app/[locale]/(dashboard)/team/[memberId]/page.tsx` (admin-only page,
    reached from the roster row in Task 1) showing the full client list with a
    checkbox/toggle per client indicating assignment to this member, and
    `assign-clients-form.tsx` (client component calling `assignClient`/
    `unassignClient` on toggle, optimistic UI with rollback on error). Add
    copy to both message files.
  </action>
  <verify>As an admin, assign 1 of 3 stub clients to the member invited in Task 1. Sign in as that member — their dashboard/client list shows exactly that 1 client, not 3. Unassign it — the member's list goes to 0 immediately. Directly attempt (e.g. via a scratch script using the member's tenant context) to `SELECT` an unassigned client's row — 0 rows, proving the boundary is the Plan 01 RLS policy, not just this UI's query shape.</verify>
  <done>CTA-06 works end to end, and the phase's stated success criterion is demonstrably true: two team members with different roles, each seeing only what their role/assignments permit, verified at the database level not just the UI.</done>
</task>

</tasks>

<verification>
Full phase-success run: sign up one agency (Plan 02), invite two members with
different roles — one admin, one member (this task) — assign a subset of clients
to the member-role invitee, and confirm: the admin sees all clients, the member
sees only assigned ones, and a second, wholly separate agency (signed up
independently) never sees any of the first agency's team or clients. Run
`npm run build`.
</verification>

<success_criteria>
- CTA-04, CTA-05, CTA-06 all working end to end.
- Invite captures role and WhatsApp number at invite time, surviving acceptance.
- Role-based and assignment-based visibility is enforced at the database layer
  (Plan 01's RLS), with this plan's UI/actions as a thin, correctly-scoped layer
  on top — not a second, divergent source of truth for access control.
- Phase 1's stated "Éxito" criterion (ROADMAP.md) is fully demonstrated: an
  agency registers, invites 2+ members with distinct roles, each sees only what
  their role permits.
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundaciones-cuenta-equipo/01-fundaciones-cuenta-equipo-04-SUMMARY.md`
covering: the Clerk role-mapping chosen (admin/member -> Clerk org roles), the
exact webhook events that ended up firing in testing, and what Fase 2's identity
resolver should know about `team_members`/`client_assignments` shape.
</output>
