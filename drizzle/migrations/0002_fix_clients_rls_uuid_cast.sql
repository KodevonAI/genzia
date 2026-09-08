-- Fixes a UUID cast crash in clients_select_by_role (0001_rls_policies.sql).
--
-- current_setting('app.team_member_id', true) is a custom Postgres GUC. The
-- FIRST time a session ever reads a custom GUC that was never set, missing-is-
-- null (`true`) correctly returns NULL. But once the GUC has been SET (even
-- transaction-local, via set_config(..., true)) at least once on a physical
-- backend connection, Postgres creates a permanent placeholder for it — and
-- after that, resetting at transaction end returns it to '' (empty string),
-- NOT NULL. Neon's HTTP driver pools/reuses physical backend connections
-- across separate `db.batch()` calls, so a later query on the same
-- connection can observe '' instead of NULL for a GUC no one set in ITS
-- transaction.
--
-- The old policy did `current_setting('app.team_member_id', true)::uuid`
-- directly. Postgres doesn't guarantee OR short-circuit evaluation, so even
-- an admin request (role = 'admin', left side of the OR true) can still have
-- its right side evaluated — and ''::uuid raises
-- `invalid input syntax for type uuid: ""` instead of returning no match.
--
-- Fix: NULLIF(..., '') normalizes the placeholder-reset '' back to NULL
-- before the cast, so NULL::uuid (which is just NULL, no error) is compared
-- instead — the intended fail-closed "no match" behavior for a GUC that
-- isn't meaningfully set in this transaction.

DROP POLICY clients_select_by_role ON clients;
--> statement-breakpoint

CREATE POLICY clients_select_by_role ON clients
  FOR SELECT
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND (
      current_setting('app.role', true) = 'admin'
      OR id IN (
        SELECT client_id FROM client_assignments
        WHERE team_member_id = NULLIF(current_setting('app.team_member_id', true), '')::uuid
      )
    )
  );
