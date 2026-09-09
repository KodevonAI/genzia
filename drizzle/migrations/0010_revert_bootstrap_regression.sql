-- Reverts three of 0009_unknown_identity_lockout_fix.sql's five policy
-- changes after discovering they break legitimate, pre-existing write/read
-- paths that run with only app.agency_id set and no app.role:
--
--   - lib/agencies/create-agency.ts (organization.created webhook): INSERTs
--     the agencies row itself, before any team_members row — and therefore
--     any role — can exist.
--   - lib/agencies/create-agency.ts markAgencyInactiveFromClerkOrg
--     (organization.deleted webhook): UPDATEs agencies by id, same
--     no-role-yet context. An UPDATE's USING clause gates which rows are
--     even visible to update; 0009's stricter USING made this a silent
--     no-op (0 rows updated, no error) rather than a crash.
--   - lib/team/sync-membership.ts (organizationMembership.created webhook):
--     SELECTs from team_members by email with only app.agency_id set, to
--     detect whether an invited row already exists before deciding whether
--     to activate it or bootstrap the founder's admin row. 0009's stricter
--     team_members USING made this SELECT always return zero rows, which
--     would silently misroute every real member-acceptance event.
--
-- These three tables (team_members, agencies) and client_assignments /
-- agent_brand_config (reverted here too, out of caution, even though nothing
-- currently reads/writes them without a role — no proven regression, but no
-- proven need to diverge from 0007 either) are restored to their exact
-- 0007_client_contact_scope.sql clauses.
--
-- authorized_contacts_select_team_only is NOT reverted: nothing in this
-- codebase reads authorized_contacts with app.role unset (Server Actions in
-- lib/clients/manage-authorized-contacts.ts always run through
-- withTenantContext with an admin role already set), so 0009's tightening
-- of that one policy is safe and stays in effect — see
-- 02-07-SUMMARY.md for why it's the one part of 0009 that IS correct.
--
-- The remaining gap — an `unknown` resolved WhatsApp identity (SEG-12) can
-- still SELECT team_members, because RLS cannot distinguish that context
-- from the Clerk webhooks' legitimate agency_id-only reads without a new,
-- explicit trust signal — is left open pending a design decision (see
-- 02-07-SUMMARY.md) rather than being papered over with another guessed
-- migration.

DROP POLICY team_members_tenant_isolation ON team_members;
--> statement-breakpoint

CREATE POLICY team_members_tenant_isolation ON team_members
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND coalesce(current_setting('app.role', true), '') <> 'client_contact'
  )
  WITH CHECK (
    agency_id = current_setting('app.agency_id', true)
    AND coalesce(current_setting('app.role', true), '') <> 'client_contact'
  );
--> statement-breakpoint

DROP POLICY client_assignments_tenant_isolation ON client_assignments;
--> statement-breakpoint

CREATE POLICY client_assignments_tenant_isolation ON client_assignments
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND coalesce(current_setting('app.role', true), '') <> 'client_contact'
  )
  WITH CHECK (
    agency_id = current_setting('app.agency_id', true)
    AND coalesce(current_setting('app.role', true), '') <> 'client_contact'
  );
--> statement-breakpoint

DROP POLICY agent_brand_config_tenant_isolation ON agent_brand_config;
--> statement-breakpoint

CREATE POLICY agent_brand_config_tenant_isolation ON agent_brand_config
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND coalesce(current_setting('app.role', true), '') <> 'client_contact'
  )
  WITH CHECK (
    agency_id = current_setting('app.agency_id', true)
    AND coalesce(current_setting('app.role', true), '') <> 'client_contact'
  );
--> statement-breakpoint

DROP POLICY agencies_tenant_isolation ON agencies;
--> statement-breakpoint

CREATE POLICY agencies_tenant_isolation ON agencies
  USING (
    id = current_setting('app.agency_id', true)
    AND coalesce(current_setting('app.role', true), '') <> 'client_contact'
  )
  WITH CHECK (
    id = current_setting('app.agency_id', true)
    AND coalesce(current_setting('app.role', true), '') <> 'client_contact'
  );
