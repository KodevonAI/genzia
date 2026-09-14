-- Phase 5 (CRM): replaces `clients_write_admin_only` (0001) with three
-- role-scoped policies, one per write operation. INSERT cannot check
-- assignment because the row (and therefore the assignment) doesn't exist
-- yet, so it must be a separate policy from UPDATE.
--
-- Why this is required, not optional: every write path to `clients` — the
-- agent tool's `execute()` (via `withResolvedIdentityContext`) and the web
-- form's Server Action (via `withTenantContext`) — sets `app.role` from the
-- ACTUAL caller's `team_members.role`. Under the old `clients_write_admin_only`
-- policy, a `member` calling `create_client` (dictation or form) has their
-- INSERT rejected by a raw Postgres RLS violation, making D-13 ("cualquier
-- miembro puede dar de alta un cliente") structurally impossible.
--
-- `clients_select_by_role` (0007) is NOT touched here — do not re-issue it.

DROP POLICY clients_write_admin_only ON clients;
--> statement-breakpoint

-- D-13: any team member may create a new client (self-assignment happens in
-- a separate client_assignments insert right after, in application code).
CREATE POLICY clients_insert_by_team_member ON clients
  FOR INSERT
  WITH CHECK (
    agency_id = current_setting('app.agency_id', true)
    AND current_setting('app.role', true) in ('admin', 'member')
  );
--> statement-breakpoint

-- D-11: write visibility mirrors read visibility exactly — admin edits
-- everything, a member only what they're assigned (client_assignments).
-- `client_contact` gets no branch here on purpose — the client never writes
-- `clients`. The uuid GUC follows the 0002/0007 lesson:
-- `NULLIF(current_setting('app.team_member_id', true), '')::uuid`, never a
-- bare `::uuid` cast (a reused pooled connection returns '', not NULL, for a
-- transaction-local GUC after its first use on that backend).
CREATE POLICY clients_update_by_role ON clients
  FOR UPDATE
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND (
      current_setting('app.role', true) = 'admin'
      OR id IN (
        SELECT client_id FROM client_assignments
        WHERE team_member_id = NULLIF(current_setting('app.team_member_id', true), '')::uuid
      )
    )
  )
  WITH CHECK (
    agency_id = current_setting('app.agency_id', true)
    AND (
      current_setting('app.role', true) = 'admin'
      OR id IN (
        SELECT client_id FROM client_assignments
        WHERE team_member_id = NULLIF(current_setting('app.team_member_id', true), '')::uuid
      )
    )
  );
--> statement-breakpoint

-- D-14: no delete/archive feature exists this phase — keep DELETE
-- admin-only as a conservative default (nothing calls it either way).
CREATE POLICY clients_delete_admin_only ON clients
  FOR DELETE
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND current_setting('app.role', true) = 'admin'
  );
