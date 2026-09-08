-- Defense-in-depth for client_assignments (CTA-06), belt-and-suspenders
-- alongside client_assignments_tenant_isolation (0001_rls_policies.sql).
--
-- RLS's USING/WITH CHECK on client_assignments already guarantees a written
-- row's agency_id matches the CALLER's own app.agency_id — that blocks a
-- caller in the wrong tenant context from writing at all. It does NOT
-- guarantee that client_id and team_member_id, once agency_id passes that
-- check, actually belong to THAT SAME agency as each other — a bug in
-- application code (not a malicious caller) could still assign a client
-- from one agency to a team member of another, both nominally "belonging"
-- to the acting agency's own agency_id column value, entirely undetected by
-- RLS or by the plain foreign keys on client_id/team_member_id (which only
-- check the referenced row EXISTS, not which agency it belongs to).
--
-- Postgres CHECK constraints cannot reference other tables (no subqueries),
-- so this needs a trigger, not a CHECK.
--
-- Named 0004, not 0003 (as lib/clients/assign-client.ts's originating plan
-- text names it) — 0003 was already claimed by 0003_agencies_status.sql
-- (Plan 02) by the time this plan executed.

CREATE OR REPLACE FUNCTION client_assignments_agency_consistency()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM clients
    WHERE clients.id = NEW.client_id AND clients.agency_id = NEW.agency_id
  ) THEN
    RAISE EXCEPTION
      'client_assignments.agency_id (%) does not match clients.agency_id for client_id %',
      NEW.agency_id, NEW.client_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_members.id = NEW.team_member_id AND team_members.agency_id = NEW.agency_id
  ) THEN
    RAISE EXCEPTION
      'client_assignments.agency_id (%) does not match team_members.agency_id for team_member_id %',
      NEW.agency_id, NEW.team_member_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER client_assignments_agency_consistency_trigger
  BEFORE INSERT OR UPDATE ON client_assignments
  FOR EACH ROW
  EXECUTE FUNCTION client_assignments_agency_consistency();
