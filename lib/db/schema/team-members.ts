import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencies } from "./agencies";

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: text("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    // Nullable until the invited user accepts and signs in via Clerk — set
    // once by the Clerk webhook handler (Plan 02).
    clerkUserId: text("clerk_user_id"),
    email: text("email").notNull(),
    role: text("role").notNull(),
    whatsappNumber: text("whatsapp_number"),
    status: text("status").notNull().default("invited"),
    invitedAt: timestamp("invited_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("team_members_agency_id_email_idx").on(
      table.agencyId,
      table.email,
    ),
    check("team_members_role_check", sql`${table.role} in ('admin', 'member')`),
    check(
      "team_members_status_check",
      sql`${table.status} in ('invited', 'active', 'removed')`,
    ),
  ],
);
