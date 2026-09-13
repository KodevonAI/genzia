-- Closes Gap 1 documented in Phase 4's research: 0007_client_contact_scope.sql
-- (see its own header, "audit_log is plain tenant isolation... the visible
-- bitácora UI (SEG-11) is Phase 4's concern, not this table's RLS shape")
-- deferred this exact shape to this phase. Until now `audit_log_tenant_isolation`
-- was a plain `agency_id = current_setting('app.agency_id', true)` for both
-- USING and WITH CHECK — ANY resolved identity that reaches an `app.agency_id`
-- scope, including a `client_contact`, could read the entire agency's
-- internal action log. Hand-authored — drizzle-kit does not generate RLS
-- policies (same reason 0001/0006/0013 give in their own headers).
--
-- LD-04 (locked decision, do not revisit): this policy gets NO `client_contact`
-- branch at all — not even a "read your own client's entries" one. SEG-11's
-- bitácora is team-only ("visible para el equipo"). This is the deliberate
-- divergence from `clients_select_by_role`'s three-branch shape (0007) — a
-- client_contact scope simply matches neither OR branch below and reads zero
-- rows. Do not "fix" this for consistency with `clients`; that would be
-- reintroducing Gap 1, not completing the convention.
--
-- LD-03 (locked decision, do not revisit): `client_id IS NULL` entries are
-- agency-internal (agent actions with no client attached) and are visible to
-- EVERY team member, admin and member alike, by deliberate product default —
-- SEG-11's wording is "bitácora completa y visible para el equipo". This is
-- not an oversight; only client-scoped rows get the `client_assignments`
-- check below.
--
-- The INSERT policy keys on `app.actor = 'system_webhook'` rather than on
-- `app.role`: the agent's own risk interceptor writes audit rows from inside
-- a conversational turn whose caller may itself be a `client_contact` (SEG-08
-- disclosure/action turns), and a client contact must never be the writer of
-- its own audit trail. The agent announces itself as a system actor exactly
-- like the Meta webhook does via `withSystemWebhookContext`
-- (lib/tenant/with-system-webhook-context.ts) — no admin or member session may
-- insert here either, by the same logic that keeps a client_contact out: the
-- bitácora records what the AGENT did, not what a human session claims it did.
--
-- Finally, UPDATE/DELETE are revoked outright: `lib/db/schema/audit-log.ts`'s
-- own header already says "Append-only by intent — no unique index, no update
-- path planned", but nothing enforced that until now. `REVOKE` operates at the
-- GRANT layer, beneath RLS, so this holds even if a future policy mistake
-- would otherwise have allowed a write through.

DROP POLICY audit_log_tenant_isolation ON audit_log;
--> statement-breakpoint

CREATE POLICY audit_log_select_by_role ON audit_log
  FOR SELECT
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND (
      coalesce(current_setting('app.role', true), '') = 'admin'
      OR (
        coalesce(current_setting('app.role', true), '') = 'member'
        AND (
          client_id IS NULL
          OR client_id IN (
            SELECT client_id FROM client_assignments
            WHERE team_member_id = NULLIF(current_setting('app.team_member_id', true), '')::uuid
          )
        )
      )
    )
  );
--> statement-breakpoint

CREATE POLICY audit_log_insert_system_actor ON audit_log
  FOR INSERT
  WITH CHECK (
    agency_id = current_setting('app.agency_id', true)
    AND coalesce(current_setting('app.actor', true), '') = 'system_webhook'
  );
--> statement-breakpoint

REVOKE UPDATE, DELETE ON audit_log FROM app_user;
