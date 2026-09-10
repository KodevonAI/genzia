-- Phase 3 (WA-03/WA-04/D-04): row-level security for the `messages` table,
-- plus the one narrow SECURITY DEFINER escape hatch that makes cross-agency
-- WhatsApp-number resolution possible at all.
--
-- Two things here deliberately DIVERGE from the Phase 1/2 conventions.
-- Read both notes before "fixing" either.
--
-- (1) The write path does NOT carry 0009's `app.role IN ('admin','member')`
--     clause. 0009 added that clause to close SEG-12 (an `unknown` identity,
--     which sets only `app.agency_id`, was passing the weaker
--     `<> 'client_contact'` test). Copying it here would block the webhook's
--     own legitimate write: D-04 requires the message row for an UNKNOWN
--     sender to be written too, and the webhook has no staff role to present.
--     Instead the webhook identifies itself with a distinct GUC,
--     `app.actor = 'system_webhook'`, so RLS can allow the webhook's
--     agency-scoped write while still denying an `unknown` identity scope any
--     read at all. `app.actor` is referenced by NO other table's policy.
--
-- (2) `find_agency_by_team_whatsapp_number` is this repo's first SECURITY
--     DEFINER function. It exists because `resolveIdentity(agencyId, phone)`
--     needs an `agencyId` the shared internal number's webhook does not yet
--     have (RESEARCH.md Critical Architecture Gap), and `team_members` has
--     FORCE ROW LEVEL SECURITY — a query with no `app.agency_id` GUC returns
--     zero rows, not "all agencies". This is option (a) of the two fixes
--     02-07-SUMMARY.md named for this class of problem. It returns exactly
--     one scalar column, `agency_id`, and nothing else. NEVER widen it to
--     return role, email, name, or a row type: the single-column return IS
--     the mitigation for T-03-04 (cross-agency data leak via the escape
--     hatch).

-- === GRANTs ===
-- GRANT and RLS are independent layers (0001_rls_policies.sql lines 54-56).
-- No DELETE grant: the message log is append-only in practice, and agency
-- deletion removes rows via the FK cascade, which is not subject to RLS.

GRANT SELECT, INSERT, UPDATE ON messages TO app_user;
--> statement-breakpoint

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- The webhook / background-send actor. FOR ALL so that INSERT ... RETURNING
-- and UPDATE ... WHERE both work: Postgres applies SELECT policies to a
-- RETURNING clause and to an UPDATE's row lookup, so a write-only policy
-- would silently break the idempotency gate (which reads back the inserted
-- id) and the WA-07 pricing backfill (which matches on meta_message_id).
CREATE POLICY messages_system_webhook_all ON messages
  FOR ALL
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND coalesce(current_setting('app.actor', true), '') = 'system_webhook'
  )
  WITH CHECK (
    agency_id = current_setting('app.agency_id', true)
    AND coalesce(current_setting('app.actor', true), '') = 'system_webhook'
  );
--> statement-breakpoint

-- Human/staff reads. Three-branch convention from 0007_client_contact_scope.sql,
-- minus any branch an `unknown` identity could satisfy: with no `app.role`
-- and no `app.actor` set, an `unknown` scope matches NEITHER policy on this
-- table and reads zero rows. That is SEG-12's guarantee, enforced here by
-- construction rather than by code review.
CREATE POLICY messages_select_by_role ON messages
  FOR SELECT
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND (
      coalesce(current_setting('app.role', true), '') IN ('admin', 'member')
      OR (
        coalesce(current_setting('app.role', true), '') = 'client_contact'
        AND client_id = NULLIF(current_setting('app.client_id', true), '')::uuid
      )
    )
  );
--> statement-breakpoint

-- === Cross-agency WhatsApp number resolution (WA-04) ===
-- STABLE (not VOLATILE) so the planner can cache it within a statement.
-- `SET search_path = public` is mandatory on a SECURITY DEFINER function:
-- without it a caller-controlled search_path could shadow `team_members`
-- with a same-named table in another schema.

CREATE FUNCTION find_agency_by_team_whatsapp_number(p_phone text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT agency_id FROM team_members
  WHERE whatsapp_number = p_phone
  LIMIT 1;
$$;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION find_agency_by_team_whatsapp_number(text) TO app_user;
