import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agencies } from "./agencies";

/**
 * Deliberately minimal — a stub so CTA-06 (assign clients to team members)
 * and the RLS isolation proof have something to reference. Phase 5 (CRM)
 * adds the real client fields to this same table via a later migration.
 */
export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: text("agency_id")
    .notNull()
    .references(() => agencies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
