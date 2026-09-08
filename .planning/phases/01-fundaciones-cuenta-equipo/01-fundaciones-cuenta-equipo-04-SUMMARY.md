---
phase: 01-fundaciones-cuenta-equipo
plan: 04
subsystem: auth
tags: [clerk-organizations, clerk-invitations, postgres-triggers, rls, next-intl]
requires:
  - 01-fundaciones-cuenta-equipo-01-SUMMARY.md (Drizzle schema —
    team_members, client_assignments; RLS policies including
    clients_select_by_role's admin/assignment split)
  - 01-fundaciones-cuenta-equipo-02-SUMMARY.md (Clerk webhook route + dashboard
    shell + db.batch([set_config, write]) pattern for tenant-context-free
    writes)
  - PROJECT.md (CTA-04/05/06)
  - REQUIREMENTS.md (CTA-04, CTA-05, CTA-06)
provides:
  - lib/team/invite-member.ts — admin-only Server Action; creates a Clerk
    organization invitation carrying { role, whatsappNumber } as
    publicMetadata, then a team_members row (status: "invited")
  - lib/team/current-member.ts — findCallerTeamMember/assertCallerIsAdmin/
    getCurrentTeamMember, the shared admin-guard reused by every admin-only
    action in this plan
  - lib/team/sync-membership.ts — organizationMembership.created handler;
    the ONE handler covering both an invited member accepting AND the
    org-creating founder (Clerk auto-adds them as a member with no
    invitation ever going through inviteMember) — closes the gap Plan 02
    flagged in its Next Phase Readiness
  - lib/team/list-members.ts — listTeamMembers/getTeamMemberById, readable by
    any team member (roster view is not admin-gated, only mutation is)
  - lib/clients/list-clients.ts — listClients/listAssignedClientIds; zero
    manual role filtering, trusts clients_select_by_role RLS entirely
  - lib/clients/assign-client.ts — assignClient/unassignClient/addClient,
    admin-only, agency_id always taken from the caller's own tenant context
  - drizzle/migrations/0004_client_assignments_check.sql — trigger enforcing
    client_assignments.agency_id consistency with both clients.agency_id and
    team_members.agency_id (write-side gap RLS alone doesn't close)
  - app/[locale]/dashboard/team/ — roster page, invite form, per-member
    client-assignment page
affects:
  - "Phase 2 (SEG-01/06/07, identity resolution) — reads team_members'
    whatsapp_number and client_assignments directly; both tables are
    populated by this plan for the first time with real data"
  - "Phase 5 (CRM) — lib/clients/list-clients.ts's addClient is a deliberate
    stub (bare name field); full client intake is CLI-01"
  - "Any future admin-only Server Action that is NOT purely an RLS-governed
    DB write (e.g. a call to an external API like Clerk's) — must call
    assertCallerIsAdmin explicitly, the same way inviteMember does; RLS does
    not protect a non-DB side effect"
tech-stack:
  added: []
  patterns:
    - "organizationMembership.created as the SINGLE webhook event covering
      both invite-acceptance and founder auto-provisioning — deliberately
      NOT also handling organizationInvitation.accepted (fires alongside it
      for the invited-member case; handling both would mean double-processing
      or arbitrarily picking one), since organizationMembership.created alone
      covers every case including the founder, which
      organizationInvitation.accepted never fires for at all."
    - "Postgres trigger (not a CHECK constraint — checks can't reference
      other tables) as a belt-and-suspenders write-side guard alongside RLS:
      RLS confirms the caller's own agency_id, the trigger confirms
      client_id/team_member_id are internally consistent with EACH OTHER's
      agency, closing a gap plain foreign keys and RLS both miss."
    - "Admin-only re-check via assertCallerIsAdmin inside every admin-only
      Server Action, even ones already inside withTenantContext (which sets
      the app.role GUC RLS reads) — required specifically for actions with a
      non-RLS-governed side effect (Clerk API calls), where RLS protects the
      eventual DB write but not the external call itself."
key-files:
  created:
    - lib/team/invite-member.ts
    - lib/team/current-member.ts
    - lib/team/sync-membership.ts
    - lib/team/list-members.ts
    - lib/clients/list-clients.ts
    - lib/clients/assign-client.ts
    - drizzle/migrations/0004_client_assignments_check.sql
    - app/[locale]/dashboard/team/page.tsx
    - app/[locale]/dashboard/team/invite-form.tsx
    - app/[locale]/dashboard/team/member-row.tsx
    - app/[locale]/dashboard/team/[memberId]/page.tsx
    - app/[locale]/dashboard/team/[memberId]/assign-clients-form.tsx
  modified:
    - app/api/webhooks/clerk/route.ts (added organizationMembership.created case)
    - app/[locale]/dashboard/page.tsx (renders listClients() so CTA-06's
      success criterion is visible somewhere concrete)
    - messages/es.json, messages/en.json (Team + client-assignment copy)
decisions:
  - "organizationMembership.created is the only extra webhook event handled
    (not organizationInvitation.accepted) — see tech-stack.patterns. Confirmed
    via the founder-provisioning path actually being exercised: signing up a
    new agency (Plan 02's onboarding) auto-creates a Clerk membership for the
    founder, which this event correctly turns into an active, admin
    team_members row with no separate invite ever having been sent."
  - "Migration numbered 0004, not 0003 as the plan's own file list named it —
    0003 was already claimed by 0003_agencies_status.sql (Plan 02) by the
    time this plan executed."
  - "listClients() and the RLS-visible roster do zero manual role filtering
    in application code — admin sees everything because clients_select_by_role
    lets it through, a member sees only assigned clients for the identical
    reason. Trusting the DB instead of re-implementing the same check in
    TypeScript, per STACK-WEB.md §2."
  - "assertCallerIsAdmin (lib/team/current-member.ts) is required even inside
    withTenantContext for inviteMember specifically because creating a Clerk
    organization invitation is an external API call, not an RLS-governed DB
    write — without this explicit check, a non-admin could still trigger the
    Clerk API call by invoking the Server Action directly, even though the
    team_members insert would separately fail RLS."
metrics:
  duration: "single session"
  completed: "2026-09-08"
---

# Phase 01 Plan 04: Team invites, roles, and per-member client assignment Summary

CTA-04/05/06 working end-to-end: an admin invites a member with a role and
WhatsApp number captured at invite time, the founder's own `team_members` row
is auto-provisioned (closing Plan 02's flagged gap), and per-member client
visibility is enforced by Plan 01's RLS policies — not just filtered in the
UI.

## Accomplishments

- Invite flow: Clerk organization invitation carrying `{ role, whatsappNumber }`
  as `publicMetadata`, paired with an immediate `team_members` row
  (`status: "invited"`) so the roster shows pending invites before acceptance
- `organizationMembership.created` webhook handler covering BOTH an invited
  member accepting AND the founder who created the org — the single event
  Clerk fires for both cases, detected via `organization.created_by ===
  public_user_data.user_id`
- Roster page (any team member can view) + admin-only invite form
- Per-member client-assignment page: toggle UI backed by `assignClient`/
  `unassignClient`, admin-only, RLS-enforced visibility on the member's side
- `client_assignments_agency_consistency` trigger closing the one write-side
  gap RLS's agency-scoped check alone doesn't cover (client and team member
  belonging to each other's same agency, not just the caller's)

## Files Created/Modified

See frontmatter `key-files`. Notable: `lib/team/current-member.ts`'s
`assertCallerIsAdmin`/`findCallerTeamMember` are the shared admin-guard
every admin-only action in this plan (and Plan 03's continuation) calls
into, rather than each action re-deriving the caller's role independently.

## Decisions Made

See frontmatter `decisions`. Most significant: choosing
`organizationMembership.created` as the single webhook event for both
invite-acceptance and founder-provisioning, rather than also handling
`organizationInvitation.accepted` — avoids double-processing the invited-member
case while still correctly covering the founder, who never goes through
`organizationInvitation.accepted` at all.

## Deviations from Plan

**1. [Rule 1 - Bug] `(dashboard)` route group named in the plan's file list would collide with the existing dashboard route**

- **Found during:** Task 1/2, mounting the team pages
- **Issue:** same class of issue as Plan 02's Deviation 1 and Plan 03's
  Deviation 1 — the plan's file list uses
  `app/[locale]/(dashboard)/team/*`, which would collide with the literal
  `app/[locale]/dashboard/` folder already established.
- **Fix:** mounted under the literal `app/[locale]/dashboard/team/` folder.
- **Files:** `app/[locale]/dashboard/team/**`

**2. [Rule 1 - Bug] Migration filename collision (0003 already claimed)**

- **Found during:** Task 2, generating the `client_assignments` consistency
  trigger migration
- **Issue:** the plan's file list names this migration
  `0003_client_assignments_check.sql`, but `0003_agencies_status.sql` (Plan
  02) already claimed that number by the time this plan executed.
- **Fix:** numbered it `0004_client_assignments_check.sql` instead.
- **Files:** `drizzle/migrations/0004_client_assignments_check.sql`,
  `drizzle/migrations/meta/_journal.json`

---

**Total deviations:** 2 auto-fixed (both naming/numbering collisions with
Plan 02's already-landed work, no functional impact)
**Impact on plan:** None — same pattern Plan 02/03 already established for
route mounting; migration renumbering is purely sequential bookkeeping.

## Issues Encountered

None beyond the deviations above.

## User Setup Required

**Clerk Dashboard:** the existing webhook endpoint (from Plan 02) must be
subscribed to `organizationMembership.created` in addition to
`organization.created`/`organization.deleted` — done by the user directly in
the Clerk Dashboard alongside Plan 02's webhook registration.

## Verification (completed on the user's local machine, against real Neon/Clerk)

- Signed up a fresh agency (Agencia Verificacion C) — the founder appeared
  as `admin`/`active` in `team_members` with zero invitation ever sent,
  confirming `syncTeamMemberFromClerkMembership`'s founder-detection branch
  works for real (required subscribing the existing webhook endpoint to
  `organizationMembership.created` in the Clerk Dashboard — the plan's own
  `user_setup` step).
- Invited a second user (`role: member`, a real WhatsApp number) — the
  invitee accepted (Clerk's dev-mode invitation flow), and their
  `team_members` row transitioned to `active` with `clerk_user_id` and
  `whatsapp_number` both correctly populated.
- Confirmed the invite form and the per-member assignment page are both
  invisible to the non-admin member in the roster UI, and a direct
  navigation to `/dashboard/team/[memberId]` as that member redirects away
  (admin-only enforced, not just hidden).
- Assigned one client to the member: the member's own dashboard then showed
  *exactly* that client, not the second unassigned one — proven at the data
  layer (queried `client_assignments` directly), not just the UI. Unassigned
  it: the row was removed and the member's visible-client set returned to
  empty.

**CTA-04, CTA-05, and CTA-06 are fully confirmed working end-to-end.**

## Next Phase Readiness

- **Phase 2 (identity resolution, SEG-01/06/07)** reads `team_members.
  whatsapp_number` and `client_assignments` — both now populated with real
  data by this plan and confirmed correct.
- Cross-agency isolation of `team_members`/`client_assignments` was not
  re-exercised manually in this verification pass, but relies on the exact
  same `*_tenant_isolation` RLS policy shape already proven 7/7 in Plan 01 —
  no new isolation mechanism was introduced here.
- `scripts/verify-rls-isolation.ts` still only exercises `clients` reads
  under an established tenant context (Plan 01's own note) — it does not
  cover the `client_assignments` write path this plan adds. Worth extending
  in a future plan.
- Plan 03's Deviation 2 (`middleware.ts` excluding `/api/**` from Clerk's
  auth context) applies to this plan too in principle, but every one of
  Plan 04's mutations (`inviteMember`, `assignClient`, `unassignClient`,
  `addClient`) are Server Actions invoked from a page under
  `app/[locale]/dashboard/**`, not a separate `/api/*` route — so they were
  never affected by that bug. Only Plan 03's `/api/uploads/brand-logo` (an
  actual Route Handler) was.

---
*Phase: 01-fundaciones-cuenta-equipo*
*Completed: 2026-09-08*
