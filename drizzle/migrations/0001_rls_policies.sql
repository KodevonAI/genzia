-- Hand-authored — drizzle-kit does not generate RLS policies (open RFC,
-- see STACK-WEB.md §2). This migration is the structural enforcement of
-- tenant isolation (agency_id) and, on `clients`, role-aware visibility
-- (admin vs. member via client_assignments), anticipating CTA-06.
--
-- Every policy uses `current_setting(<guc>, true)` — the missing-is-null
-- form — never the two-argument-less form, so a request with no tenant
-- context set (no GUC set at all) gets NULL, which matches nothing, instead
-- of raising a Postgres error. NULL = anything is NULL (not true), so a
-- missing `app.agency_id` correctly yields zero rows rather than an error or
-- (worse) every row.
--
-- FORCE ROW LEVEL SECURITY only has an effect on a role that does NOT own
-- the table (Postgres exempts table owners from RLS unconditionally). The
-- role that owns these tables is whichever role ran migrations (0000_*),
-- typically the Neon default role for this database/branch. `app_user` is a
-- separate, non-owner role that the application's DATABASE_URL must connect
-- as in every environment — created here, with just enough grants to read
-- and write through RLS, nothing else (no DDL, no BYPASSRLS, not a
-- superuser).

-- === app_user role: the connection RLS is actually enforced against ===
--
-- Deliberately created with NO password here — never hardcode a real
-- credential in a migration file that lands in git history. This role
-- cannot log in until a password is set out of band, after this migration
-- runs, by either:
--   (a) `neonctl roles create --name app_user --project-id <id>` (Neon's own
--       role management — generates and stores the password for you, gives
--       you a ready-made connection string), which will complain the role
--       already exists if this DO block already created it — in that case
--       skip straight to (b), or
--   (b) `ALTER ROLE app_user WITH PASSWORD '<generated secret>';` run by
--       hand against DATABASE_URL (the owner role), with the secret coming
--       from a password manager / `openssl rand -base64 32`, never typed
--       into a file this repo tracks.
-- Either way, DATABASE_URL for the application must then be swapped to
-- connect as app_user (same host/db, different user+password) so that
-- FORCE ROW LEVEL SECURITY below actually applies — Postgres exempts table
-- owners (the role that ran 0000_initial_schema.sql) from RLS unconditionally,
-- FORCE or not.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  agencies, team_members, clients, client_assignments, agent_brand_config
  TO app_user;
-- Sequences aren't used (all surrogate keys are uuid defaults via
-- gen_random_uuid(), not serial/identity), so no sequence grants needed.

-- === agencies: single-row policy, restricted to the caller's own tenant ===

ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE agencies FORCE ROW LEVEL SECURITY;

CREATE POLICY agencies_tenant_isolation ON agencies
  USING (id = current_setting('app.agency_id', true))
  WITH CHECK (id = current_setting('app.agency_id', true));

-- === team_members: standard agency_id isolation ===

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members FORCE ROW LEVEL SECURITY;

CREATE POLICY team_members_tenant_isolation ON team_members
  USING (agency_id = current_setting('app.agency_id', true))
  WITH CHECK (agency_id = current_setting('app.agency_id', true));

-- === client_assignments: standard agency_id isolation ===

ALTER TABLE client_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY client_assignments_tenant_isolation ON client_assignments
  USING (agency_id = current_setting('app.agency_id', true))
  WITH CHECK (agency_id = current_setting('app.agency_id', true));

-- === agent_brand_config: standard agency_id isolation ===

ALTER TABLE agent_brand_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_brand_config FORCE ROW LEVEL SECURITY;

CREATE POLICY agent_brand_config_tenant_isolation ON agent_brand_config
  USING (agency_id = current_setting('app.agency_id', true))
  WITH CHECK (agency_id = current_setting('app.agency_id', true));

-- === clients: agency_id isolation PLUS role-aware visibility ===
--
-- Two separate policies, deliberately not one combined ALL policy:
--   1. SELECT: admins see every client in their agency; members see only
--      clients they're assigned to via client_assignments.
--   2. INSERT/UPDATE/DELETE: admins only, in this phase — members do not
--      manage the client roster itself (Phase 5 revisits as CRM permissions
--      grow; assigning an *existing* client to a member is a
--      client_assignments write, governed by that table's own policy above,
--      not this one).

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients FORCE ROW LEVEL SECURITY;

CREATE POLICY clients_select_by_role ON clients
  FOR SELECT
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND (
      current_setting('app.role', true) = 'admin'
      OR id IN (
        SELECT client_id FROM client_assignments
        WHERE team_member_id = current_setting('app.team_member_id', true)::uuid
      )
    )
  );

CREATE POLICY clients_write_admin_only ON clients
  FOR ALL
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND current_setting('app.role', true) = 'admin'
  )
  WITH CHECK (
    agency_id = current_setting('app.agency_id', true)
    AND current_setting('app.role', true) = 'admin'
  );
