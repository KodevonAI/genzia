-- Secures the three tables created in 0005_phase2_identity_tables.sql.
-- Hand-authored — drizzle-kit does not generate RLS policies (same reason
-- 0001_rls_policies.sql's own header comment gives).
--
-- `authorized_contacts` SELECT is agency-wide per D-09: any member of the
-- agency sees the whole contact roster, no per-client filtering — this
-- mirrors how `team_members` is agency-wide today. Writes are admin-only per
-- D-10, matching `clients_write_admin_only` (0001) and `assertCallerIsAdmin`
-- in lib/clients/assign-client.ts.
--
-- `audit_log` is plain tenant isolation — a schema shell in this phase (no
-- writer yet), but the policy must exist from day one so Phase 4 doesn't
-- inherit an unenforced table.
--
-- `agent_action_catalog` is global platform data (RESEARCH.md Assumption
-- A3): identical for every agency, not tenant data. It gets NO row-level
-- security at all and a SELECT-only grant — see the note at that section
-- below before "fixing" the apparent omission.

-- === GRANTs ===
--
-- Without these every query against these tables fails with a permissions
-- error, not merely an RLS-filtered empty set — GRANT and RLS are two
-- independent layers (0001_rls_policies.sql lines 54-56 established the
-- same split for the Phase 1 tables).

GRANT SELECT, INSERT, UPDATE, DELETE ON authorized_contacts, audit_log TO app_user;
--> statement-breakpoint
GRANT SELECT ON agent_action_catalog TO app_user;
--> statement-breakpoint

-- === authorized_contacts: two deliberately separate policies ===
--
-- Not one combined FOR ALL policy — mirroring the `clients` split in
-- 0001_rls_policies.sql lines 109-118 (clients_select_by_role /
-- clients_write_admin_only), because the read and write rules here have
-- genuinely different shapes (agency-wide read, admin-only write).

ALTER TABLE authorized_contacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE authorized_contacts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- The `<> 'client_contact'` clause is this phase's concrete mechanism for
-- SEG-08: the contact roster is a "solo-equipo" resource, and a resolved
-- client contact must never read it — not for its own client, not for any
-- other. Never add a `client_contact` SELECT branch to this table (D-09,
-- RESEARCH.md Open Question #1).
--
-- `coalesce(..., '')` is required because `<>` against NULL yields NULL,
-- which would fail the whole USING clause even for legitimate admin callers
-- whose `app.role` happens to be unset (same fail-closed reasoning as
-- 0002_fix_clients_rls_uuid_cast.sql, applied to a text comparison instead
-- of a uuid cast).

CREATE POLICY authorized_contacts_select_team_only ON authorized_contacts
  FOR SELECT
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND coalesce(current_setting('app.role', true), '') <> 'client_contact'
  );
--> statement-breakpoint

CREATE POLICY authorized_contacts_write_admin_only ON authorized_contacts
  FOR ALL
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND current_setting('app.role', true) = 'admin'
  )
  WITH CHECK (
    agency_id = current_setting('app.agency_id', true)
    AND current_setting('app.role', true) = 'admin'
  );
--> statement-breakpoint

-- === audit_log: plain tenant isolation ===
--
-- Copied from the client_assignments_tenant_isolation shape in
-- 0001_rls_policies.sql lines 87-94, renamed. No role-based branching here —
-- the visible bitácora UI (SEG-11) is Phase 4's concern, not this table's
-- RLS shape.

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY audit_log_tenant_isolation ON audit_log
  USING (agency_id = current_setting('app.agency_id', true))
  WITH CHECK (agency_id = current_setting('app.agency_id', true));
--> statement-breakpoint

-- === agent_action_catalog: intentionally NO row-level security ===
--
-- This is global, non-tenant data (RESEARCH.md Assumption A3) — every agency
-- reads the identical catalog. There is deliberately no `ENABLE ROW LEVEL
-- SECURITY` / `FORCE ROW LEVEL SECURITY` here and no policy: a future reader
-- must not "fix" this apparent omission by adding one. The SELECT-only GRANT
-- above is the entire access-control surface this table needs.

-- === Cross-table phone-collision guard (RESEARCH.md Pitfall 1, T-02-02) ===
--
-- Postgres CHECK constraints cannot reference another table (see
-- 0004_client_assignments_check.sql lines 15-16), so this needs triggers,
-- not a CHECK. Both functions run SECURITY INVOKER (the default — same as
-- 0004): both tables' SELECT policies are agency-gated only (not
-- role-gated for the caller's own agency), so an admin caller writing either
-- table can read the other inside the trigger.
--
-- Why this needs enforcing in both directions: `resolveIdentity` checks
-- `team_members` first (D-06), so an undetected collision would permanently
-- and silently resolve a client contact as a team member — an elevation of
-- privilege, not a cosmetic bug.

CREATE OR REPLACE FUNCTION authorized_contacts_phone_uniqueness_guard()
RETURNS trigger AS $$
DECLARE
  existing_client_name text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM team_members
    WHERE team_members.agency_id = NEW.agency_id
      AND team_members.whatsapp_number = NEW.phone_number
  ) THEN
    RAISE EXCEPTION
      'phone_number % is already registered as a team member WhatsApp number in agency %',
      NEW.phone_number, NEW.agency_id;
  END IF;

  SELECT clients.name INTO existing_client_name
  FROM authorized_contacts
  JOIN clients ON clients.id = authorized_contacts.client_id
  WHERE authorized_contacts.agency_id = NEW.agency_id
    AND authorized_contacts.phone_number = NEW.phone_number
    AND authorized_contacts.client_id <> NEW.client_id
  LIMIT 1;

  IF existing_client_name IS NOT NULL THEN
    RAISE EXCEPTION
      'phone_number % is already linked to client "%" in this agency — one number belongs to exactly one client',
      NEW.phone_number, existing_client_name;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER authorized_contacts_phone_uniqueness_guard_trigger
  BEFORE INSERT OR UPDATE ON authorized_contacts
  FOR EACH ROW
  EXECUTE FUNCTION authorized_contacts_phone_uniqueness_guard();
--> statement-breakpoint

-- Mirror direction, so the collision cannot be created from the team side.

CREATE OR REPLACE FUNCTION team_members_whatsapp_uniqueness_guard()
RETURNS trigger AS $$
BEGIN
  IF NEW.whatsapp_number IS NOT NULL AND EXISTS (
    SELECT 1 FROM authorized_contacts
    WHERE authorized_contacts.agency_id = NEW.agency_id
      AND authorized_contacts.phone_number = NEW.whatsapp_number
  ) THEN
    RAISE EXCEPTION
      'whatsapp_number % is already registered as an authorized client contact in agency %',
      NEW.whatsapp_number, NEW.agency_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER team_members_whatsapp_uniqueness_guard_trigger
  BEFORE INSERT OR UPDATE ON team_members
  FOR EACH ROW
  EXECUTE FUNCTION team_members_whatsapp_uniqueness_guard();
