-- Closes Gap 2 documented in Phase 4's research: 0013_whatsapp_messages_rls.sql
-- shipped `messages_select_by_role` with `admin` and `member` collapsed into
-- ONE branch — `coalesce(current_setting('app.role', true), '') IN ('admin',
-- 'member')` — with NO `client_assignments` check at all. That meant any
-- resolved team member, regardless of which clients they were actually
-- assigned, could read every client's entire WhatsApp conversation history in
-- the agency. This is the exact leak STATE.md's "Decisiones clave" section
-- names as a hard invariant for every client-scoped table ("Convención de
-- tres ramas para RLS en toda tabla client-scoped futura... Copiar solo dos
-- ramas reintroduce en silencio la fuga que esta fase existe para prevenir").
-- Hand-authored — drizzle-kit does not generate RLS policies.
--
-- LD-03 (locked decision, do not revisit): the `client_id IS NULL` allowance
-- inside the member branch below is the team-internal channel (WA-03's shared
-- platform number, and Phase 4's agency-wide agent actions) — SEG-11 makes
-- that history visible to the whole team on purpose, admin and member alike.
-- This clause is a deliberate product default, not an oversight left over
-- from the collapsed branch it replaces.
--
-- `messages_system_webhook_all` (0013) is deliberately left untouched by this
-- migration: the webhook actor sets no `app.role` at all (only
-- `app.actor = 'system_webhook'`), so it never matched `messages_select_by_role`
-- in the first place and must keep its own `FOR ALL` write/read-back path
-- exactly as 0013 defined it.
--
-- An `unknown` identity scope (no `app.role`, no `app.actor`) still matches
-- neither policy on this table after this migration — SEG-12's guarantee
-- (0013's own comment: "read zero rows... enforced here by construction
-- rather than by code review") is preserved unchanged.

DROP POLICY messages_select_by_role ON messages;
--> statement-breakpoint

CREATE POLICY messages_select_by_role ON messages
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
      OR (
        coalesce(current_setting('app.role', true), '') = 'client_contact'
        AND client_id = NULLIF(current_setting('app.client_id', true), '')::uuid
      )
    )
  );
