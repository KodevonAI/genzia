-- Multi-thread web chat (supersedes LD-16's "one thread per team member, no
-- thread management UI" for the web channel — explicit product decision,
-- 2026-09-14: the dashboard chat surface gets a sidebar of named
-- conversations, same way any chat product does). LD-02 (team-only, no
-- client_contact channel) and LD-03 (team-internal history visible to the
-- whole team, admin and member alike) are NOT superseded — a conversation
-- still belongs to exactly one team member and is still agency-internal;
-- only the "one thread total" part of LD-16 changes. Hand-authored, same
-- reason 0001/0006/0013/0014/0015/0016/0017 give: RLS policies are not
-- something `drizzle-kit generate` can produce.
--
-- The new FK column on `messages` is named `thread_id`, NOT
-- `conversation_id` — that name was already taken (Meta's own
-- billing-conversation id from the WhatsApp webhook, a `text` column,
-- completely unrelated concept).
--
-- `conversations.title` starts NULL and is filled in by a best-effort cheap
-- LLM call (`lib/agent/generate-title.ts`, MODEL_FOR_TASK.cheap) after the
-- first exchange — never blocks the turn itself; a NULL title just falls
-- back to a client-side placeholder ("New chat"/timestamp) until the
-- follow-up UPDATE lands. `updated_at` is bumped on every new message in the
-- thread so the sidebar can sort by recency without a join to `messages`.

CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" text NOT NULL,
	"team_member_id" uuid NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "conversations_agency_id_team_member_id_idx" ON "conversations" USING btree ("agency_id","team_member_id");
--> statement-breakpoint

-- === Backfill: every team member with existing web-channel history gets
-- ONE conversation grouping all of it, so migrating to multi-thread never
-- loses a message. `min/max(created_at)` keeps the new row's timestamps
-- honest (when the thread actually started/was last active) instead of
-- "now" for every backfilled row.

INSERT INTO conversations (id, agency_id, team_member_id, title, created_at, updated_at)
SELECT gen_random_uuid(), agency_id, resolved_identity_id, NULL, min(created_at), max(created_at)
FROM messages
WHERE channel = 'web' AND resolved_identity_id IS NOT NULL
GROUP BY agency_id, resolved_identity_id;
--> statement-breakpoint

ALTER TABLE "messages" ADD COLUMN "thread_id" uuid;
--> statement-breakpoint

UPDATE messages m
SET thread_id = c.id
FROM conversations c
WHERE m.channel = 'web'
  AND m.resolved_identity_id = c.team_member_id
  AND m.agency_id = c.agency_id;
--> statement-breakpoint

ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_conversations_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- Mirrors messages_whatsapp_phone_numbers_check's shape (0017): a
-- conditional NOT-NULL that only applies for one channel, which plain
-- column nullability cannot express. Safe to add now because the backfill
-- above has already run inside this same migration file.
ALTER TABLE "messages" ADD CONSTRAINT "messages_web_conversation_id_check"
  CHECK (channel <> 'web' OR thread_id IS NOT NULL);
--> statement-breakpoint

-- === GRANTs (0001_rls_policies.sql's independent-layer pattern) ===
-- No DELETE grant, same reasoning 0013/0016 give: agency deletion removes
-- rows via the FK cascade, which is not subject to RLS.

GRANT SELECT, INSERT, UPDATE ON conversations TO app_user;
--> statement-breakpoint

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Read policy: same team-internal transparency LD-03 already established
-- for messages/audit_log/approval_queue (client_id IS NULL branch) — every
-- conversation here is team-internal by construction (no client_id column
-- at all), so admin and member both see the whole agency's conversations.
-- No client_contact branch, same posture as LD-04's approval_queue.
CREATE POLICY conversations_select_by_role ON conversations
  FOR SELECT
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND coalesce(current_setting('app.role', true), '') IN ('admin', 'member')
  );
--> statement-breakpoint

-- Write policies: unlike SELECT, a team member may only create/rename their
-- OWN conversations — same "cannot write attributed to someone else"
-- invariant messages_web_chat_insert (0017) already enforces for messages.
CREATE POLICY conversations_insert_own ON conversations
  FOR INSERT
  WITH CHECK (
    agency_id = current_setting('app.agency_id', true)
    AND coalesce(current_setting('app.role', true), '') IN ('admin', 'member')
    AND team_member_id = NULLIF(current_setting('app.team_member_id', true), '')::uuid
  );
--> statement-breakpoint

CREATE POLICY conversations_update_own ON conversations
  FOR UPDATE
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND coalesce(current_setting('app.role', true), '') IN ('admin', 'member')
    AND team_member_id = NULLIF(current_setting('app.team_member_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = current_setting('app.agency_id', true)
    AND coalesce(current_setting('app.role', true), '') IN ('admin', 'member')
    AND team_member_id = NULLIF(current_setting('app.team_member_id', true), '')::uuid
  );
--> statement-breakpoint

-- Tightens messages_web_chat_insert (0017) with a thread-ownership check: a
-- member could already only attribute a web message to themself
-- (resolved_identity_id = their own team_member_id); this closes the new gap
-- multi-thread opens — writing into a thread_id that exists but belongs to
-- a DIFFERENT team member. Same predicates as 0017 plus one clause; not a
-- behavioral change for anything else the old policy allowed.
DROP POLICY messages_web_chat_insert ON messages;
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
    AND thread_id IN (
      SELECT id FROM conversations
      WHERE agency_id = current_setting('app.agency_id', true)
        AND team_member_id = NULLIF(current_setting('app.team_member_id', true), '')::uuid
    )
  );
