-- Fixes a real bug found by scripts/verify-identity-resolution.ts (Phase 2
-- checkpoint 02-07, assertions 8b/8c) when run against real Neon.
--
-- 0007_client_contact_scope.sql locked the `client_contact` role out of
-- every team-only table using `coalesce(current_setting('app.role', true),
-- '') <> 'client_contact'`. That clause is FAIL-OPEN for an `unknown`
-- identity (SEG-12): withResolvedIdentityContext sets only app.agency_id
-- for an unknown phone number, leaving app.role unset. coalesce(NULL, '')
-- = '', and '' <> 'client_contact' is true, so the policy allowed the read
-- instead of blocking it — SEG-12 requires unknown callers to read zero
-- rows from every tenant table, not just be denied client_contact-shaped
-- access.
--
-- Fix: require app.role to be an actual staff role (admin or member),
-- rather than merely not-client_contact. Every legitimate caller of these
-- five tables always has app.role = 'admin' or 'member' set by
-- withTenantContext (Phase 1) or withResolvedIdentityContext (Phase 2) —
-- this clause is inert for every existing Phase 1/Phase 2 admin/member
-- context and only closes the unknown/client_contact gap.
--
-- scripts/verify-rls-isolation.ts (Phase 1 regression) and
-- scripts/verify-identity-resolution.ts assertions 1-14 must still pass
-- unchanged after this migration.

DROP POLICY team_members_tenant_isolation ON team_members;
--> statement-breakpoint

CREATE POLICY team_members_tenant_isolation ON team_members
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND current_setting('app.role', true) IN ('admin', 'member')
  )
  WITH CHECK (
    agency_id = current_setting('app.agency_id', true)
    AND current_setting('app.role', true) IN ('admin', 'member')
  );
--> statement-breakpoint

DROP POLICY client_assignments_tenant_isolation ON client_assignments;
--> statement-breakpoint

CREATE POLICY client_assignments_tenant_isolation ON client_assignments
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND current_setting('app.role', true) IN ('admin', 'member')
  )
  WITH CHECK (
    agency_id = current_setting('app.agency_id', true)
    AND current_setting('app.role', true) IN ('admin', 'member')
  );
--> statement-breakpoint

DROP POLICY agent_brand_config_tenant_isolation ON agent_brand_config;
--> statement-breakpoint

CREATE POLICY agent_brand_config_tenant_isolation ON agent_brand_config
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND current_setting('app.role', true) IN ('admin', 'member')
  )
  WITH CHECK (
    agency_id = current_setting('app.agency_id', true)
    AND current_setting('app.role', true) IN ('admin', 'member')
  );
--> statement-breakpoint

DROP POLICY agencies_tenant_isolation ON agencies;
--> statement-breakpoint

CREATE POLICY agencies_tenant_isolation ON agencies
  USING (
    id = current_setting('app.agency_id', true)
    AND current_setting('app.role', true) IN ('admin', 'member')
  )
  WITH CHECK (
    id = current_setting('app.agency_id', true)
    AND current_setting('app.role', true) IN ('admin', 'member')
  );
--> statement-breakpoint

DROP POLICY authorized_contacts_select_team_only ON authorized_contacts;
--> statement-breakpoint

CREATE POLICY authorized_contacts_select_team_only ON authorized_contacts
  FOR SELECT
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND current_setting('app.role', true) IN ('admin', 'member')
  );
