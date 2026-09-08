import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { agencies } from "./agencies";

/**
 * One row per agency: how the agent presents itself to that agency's
 * clients (white-label — CTA-02). Keyed directly by `agency_id`, no
 * surrogate id, since it's a 1:1 extension of `agencies`.
 */
export const agentBrandConfig = pgTable("agent_brand_config", {
  agencyId: text("agency_id")
    .primaryKey()
    .references(() => agencies.id, { onDelete: "cascade" }),
  agentName: text("agent_name"),
  tone: text("tone"),
  logoUrl: text("logo_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
