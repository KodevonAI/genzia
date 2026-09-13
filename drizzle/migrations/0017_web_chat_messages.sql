-- Makes the web channel writable (WA-05/SIS-01/SEG-09/SEG-05, plan 04-10):
-- the dashboard chat surface is the second half of "el agente responde con
-- criterio, en el chat web y por WhatsApp" — Phase 3 already covers the
-- client-facing WhatsApp channel end to end.
--
-- (1) Phone numbers become nullable. A web-chat message has no phone numbers
--     at all, so `messages.from_phone_number`/`to_phone_number` can no
--     longer be NOT NULL. The WhatsApp invariant ("a whatsapp-channel row
--     must carry both numbers") does not disappear — it moves to a CHECK
--     (`messages_whatsapp_phone_numbers_check`), which is the correct place
--     for a constraint that only applies conditionally on another column's
--     value; plain column nullability cannot express "required only when
--     channel = 'whatsapp'".
--
-- (2) `messages_channel_check` closes the channel column to exactly the two
--     values this codebase understands. `channel` carried no CHECK before
--     this migration — it was future-proofed (see the old comment on the
--     column) but never actually constrained.
--
-- (3) `messages_web_chat_insert`: LD-02 (locked decision) — the web chat is
--     TEAM-ONLY in this phase, authenticated by the caller's own Clerk
--     session through `withTenantContext`, never `withResolvedIdentityContext`.
--     That is why this policy requires a staff `app.role`
--     (`'admin'`/`'member'`) and pins `resolved_identity_id` to the caller's
--     OWN `app.team_member_id`: a team member cannot write a web message
--     attributed to a different member, and RLS rejects the row regardless
--     of what application code sends (T-04-47). A `client_contact` scope
--     (which sets `app.role = 'client_contact'`, never `'admin'`/`'member'`)
--     matches no branch of this policy at all — a client-facing web chat
--     needs a magic-link/OTP mechanism that exists nowhere in this codebase
--     and belongs to the client-portal phase (POR-01), so this migration
--     intentionally opens no door for one.
--
-- (4) LD-16 (locked decision): `client_id IS NULL` is REQUIRED by this
--     policy, not merely defaulted — a web conversation is keyed by
--     `(agency_id, channel = 'web', resolved_identity_id = the team
--     member)`, one thread per team member. A team member talking to the
--     agent is a team-internal conversation, and per LD-03 that history is
--     deliberately visible to the whole team in the bitácora (T-04-52,
--     accepted, not mitigated).
--
-- (5) `messages_select_by_role` (migration 0015) is channel-agnostic and is
--     deliberately left untouched by this migration — it already covers
--     'web' rows the same way it covers 'whatsapp' rows (agency_id + role +
--     client_assignments, with `client_id IS NULL` visible to the whole
--     team). No new SELECT policy is added here.
--
-- (6) Mandatory GUC rule (0002/0007/0013/0015/0016): every uuid GUC
--     comparison below uses `NULLIF(current_setting('app.xxx', true),
--     '')::uuid`, never a bare `::uuid` cast — a pooled connection reused
--     across requests returns `''`, not `NULL`, for a transaction-local GUC
--     after its first use on that physical backend, and `''::uuid` throws
--     instead of failing closed.
--
-- This migration DOES NOT replace or drop any existing policy — it only adds
-- two CHECK constraints and one new INSERT policy alongside what 0013/0015
-- already established.

ALTER TABLE messages ALTER COLUMN from_phone_number DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE messages ALTER COLUMN to_phone_number DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE messages ADD CONSTRAINT messages_channel_check
  CHECK (channel in ('whatsapp', 'web'));
--> statement-breakpoint
ALTER TABLE messages ADD CONSTRAINT messages_whatsapp_phone_numbers_check
  CHECK (channel <> 'whatsapp' OR (from_phone_number IS NOT NULL AND to_phone_number IS NOT NULL));
--> statement-breakpoint

CREATE POLICY messages_web_chat_insert ON messages
  FOR INSERT
  WITH CHECK (
    agency_id = current_setting('app.agency_id', true)
    AND channel = 'web'
    AND client_id IS NULL
    AND coalesce(current_setting('app.role', true), '') IN ('admin', 'member')
    AND resolved_identity_type = 'team_member'
    AND resolved_identity_id = NULLIF(current_setting('app.team_member_id', true), '')::uuid
  );
