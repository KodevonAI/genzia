import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * One row per tenant. `id` is the Clerk organization id directly — no
 * surrogate primary key — so there is no separate agency<->Clerk-org mapping
 * table to keep in sync; Clerk's `orgId` claim IS the tenant key everywhere
 * else in the schema (`agency_id` columns reference this).
 */
export const agencies = pgTable("agencies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("trial"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
