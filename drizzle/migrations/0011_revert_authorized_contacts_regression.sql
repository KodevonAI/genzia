-- Reverts 0009_unknown_identity_lockout_fix.sql's change to
-- authorized_contacts_select_team_only, the one policy 0010 deliberately
-- left in place (0010's own comment claimed it was safe — that claim was
-- wrong).
--
-- lib/identity/resolve-identity.ts's `resolveIdentity()` — the core
-- identity-resolution function itself, not a post-resolution scope — reads
-- `authorized_contacts` by (agencyId, phoneNumber) with ONLY app.agency_id
-- set, no app.role, precisely because determining whether a phone number
-- belongs to a client_contact IS what establishes the role in the first
-- place. 0009's tightened policy (requiring app.role IN ('admin',
-- 'member')) blocked this lookup outright, making every real contact
-- number resolve as `unknown` instead of `client_contact`
-- (scripts/verify-identity-resolution.ts assertions 2/3/3b regressed from
-- PASS to FAIL after 0009+0010 were applied).
--
-- At the Postgres/RLS layer, `resolveIdentity`'s legitimate
-- agency_id-only lookup and the "should be blocked" agency_id-only lookup
-- from an already-resolved `unknown` identity's `withResolvedIdentityContext`
-- scope (scripts/verify-identity-resolution.ts assertions 8b/8c) are
-- byte-for-byte indistinguishable session states. RLS, using only
-- app.agency_id/app.role, cannot enforce "unknown resolves via this read,
-- but a post-resolution unknown scope may not repeat it" — that requires
-- either a new, spoofable-by-design trust GUC (not a real security
-- boundary) or a privileged/bypass-RLS connection scoped narrowly to
-- resolveIdentity's own transaction (a real fix, but an infrastructure
-- change, not a policy tweak, and out of this checkpoint's scope).
--
-- Restores the exact 0006_phase2_identity_rls.sql clause. Net effect of
-- 0009+0010+0011 together: authorized_contacts_select_team_only,
-- team_members_tenant_isolation, client_assignments_tenant_isolation,
-- agent_brand_config_tenant_isolation and agencies_tenant_isolation are all
-- back to their exact pre-0009 state. The SEG-12 gap they attempted to
-- close (assertions 8b/8c: an unknown identity's post-resolution scope can
-- still read team_members/authorized_contacts) remains open, documented in
-- 02-07-SUMMARY.md as a residual finding for a follow-up plan, not papered
-- over with an untested migration.

DROP POLICY authorized_contacts_select_team_only ON authorized_contacts;
--> statement-breakpoint

CREATE POLICY authorized_contacts_select_team_only ON authorized_contacts
  FOR SELECT
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND coalesce(current_setting('app.role', true), '') <> 'client_contact'
  );
