import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agencies } from "./agencies";
import { teamMembers } from "./team-members";

/**
 * One web-chat thread (migration 0018 — supersedes LD-16's "one thread per
 * team member" for the web channel, see that migration's header). Always
 * team-internal: a conversation belongs to exactly one `team_member`, and
 * there is deliberately no `client_id` column, mirroring the same posture
 * `approval_queue`/`audit_log` take for agency-internal rows (LD-03/LD-04).
 *
 * `title` starts NULL and is filled in by `lib/agent/generate-title.ts`
 * (a best-effort cheap-model call, MODEL_FOR_TASK.cheap) after the first
 * exchange — never on the hot path of the turn itself.
 */
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: text("agency_id")
    .notNull()
    .references(() => agencies.id, { onDelete: "cascade" }),
  teamMemberId: uuid("team_member_id")
    .notNull()
    .references(() => teamMembers.id, { onDelete: "cascade" }),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
