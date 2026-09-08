-- Part A extends `clients_select_by_role` (0001, fixed 0002) with a third
-- branch: SEG-07's enforcement that a resolved client contact sees exactly
-- one client row via the new `app.client_id` GUC and `app.role =
-- 'client_contact'`.
--
-- `app.client_id` is a NEW uuid-typed GUC and therefore MUST use
-- `NULLIF(current_setting('app.client_id', true), '')::uuid`, never a bare
-- `::uuid` cast. 0002_fix_clients_rls_uuid_cast.sql documents the exact
-- failure mode this avoids: a reused pooled connection returns `''`, not
-- NULL, for a transaction-local GUC after its first use on that backend, and
-- `''::uuid` raises `invalid input syntax for type uuid: ""` instead of
-- failing closed; Postgres does not guarantee OR short-circuit evaluation,
-- so the crash reaches even admin callers whose branch of the OR is the one
-- that should have matched.
--
-- This admin / assigned-member / client_contact three-branch shape is the
-- named convention every future client-scoped table must repeat (Phase 5
-- CRM fields, Phase 6 calendar, Phase 7 content). Copying only two branches
-- silently reintroduces the leak this phase exists to prevent.
--
-- `clients_write_admin_only` is deliberately left untouched below: a client
-- contact must never write to `clients`, and the absence of a matching
-- branch IS the fail-closed enforcement.

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
      OR (
        current_setting('app.role', true) = 'client_contact'
        AND id = NULLIF(current_setting('app.client_id', true), '')::uuid
      )
    )
  );
--> statement-breakpoint

-- Part B — lock the `client_contact` role out of every team-only table.
-- Without this, a client-contact GUC context would satisfy the plain
-- agency-gated policies from 0001 and could read the agency's team roster
-- and assignment graph. Each policy below is dropped and recreated with one
-- added clause; nothing else changes.
--
-- The added clause is inert for every Phase 1 context (`app.role` is
-- `admin`, `member`, or unset there), so `scripts/verify-rls-isolation.ts`
-- must still pass unchanged after this migration — that is the regression
-- check, not an optional extra.

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

-- `agencies` uses `id`, not `agency_id`, as its tenant column — same shape,
-- different column name.

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
