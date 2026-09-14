-- Lets a team member delete their own conversation (sidebar ask, follow-up
-- to migration 0018). Only a GRANT + policy on `conversations` is needed:
-- `messages.thread_id`'s `ON DELETE CASCADE` (0018) removes that thread's
-- messages automatically, and per Postgres's own documented behavior,
-- referential-integrity actions like a FK CASCADE always bypass row
-- security — same "not subject to RLS" posture 0013/0016/0017 already
-- documented for the `agencies` cascade. No new grant/policy needed on
-- `messages` for this to work.
--
-- WhatsApp history is untouched: `conversations` only ever holds web
-- threads, so nothing outside `channel = 'web'` rows can ever be reached
-- through this policy.

GRANT DELETE ON conversations TO app_user;
--> statement-breakpoint

CREATE POLICY conversations_delete_own ON conversations
  FOR DELETE
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND coalesce(current_setting('app.role', true), '') IN ('admin', 'member')
    AND team_member_id = NULLIF(current_setting('app.team_member_id', true), '')::uuid
  );
