-- Phase 5 (CRM) fix, found by db:verify-clients-crm against real Neon.
--
-- client_assignments_agency_consistency() (0004) runs as INVOKER, so its own
-- internal `SELECT 1 FROM clients WHERE clients.id = NEW.client_id AND ...`
-- is itself subject to clients_select_by_role (0007, replaced in shape but
-- not in spirit by 05-01/0021's split). That was never a problem through
-- Phase 4: every client_assignments writer was either an admin (who can
-- SELECT any client in the agency) or already had the target client visible
-- some other way.
--
-- D-13 breaks that assumption: `createClient` (05-03) lets a plain member
-- self-assign to a client THEY JUST CREATED, in the same transaction, before
-- any client_assignments row exists for it. At that point
-- clients_select_by_role denies the member's own trigger-internal SELECT
-- (no admin role, no assignment row yet), the EXISTS check finds nothing,
-- and the trigger raises "does not match" on data that is in fact fully
-- consistent — this is a false positive caused by RLS visibility, not a
-- real agency mismatch.
--
-- Same escape hatch already used by 0013's
-- find_agency_by_team_whatsapp_number: SECURITY DEFINER + a pinned
-- search_path, so the consistency check itself always sees the full table
-- regardless of the invoking role's RLS scope, while the actual write
-- (client_assignments' own RLS policies, untouched here) still enforces
-- tenant isolation on the caller.

CREATE OR REPLACE FUNCTION client_assignments_agency_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;
