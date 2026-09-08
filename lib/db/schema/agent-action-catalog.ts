import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Static, platform-global catalog of agent action types and their risk level
 * (D-01/D-02 — the data-model half of SEG-10). Deliberately has no
 * per-agency foreign key and no row-level security: this is Genzia's own
 * classification table, identical for every agency, not tenant data
 * (RESEARCH.md Assumption A3). `app_user` gets SELECT only — migration 0006.
 *
 * Phase 2 seeds the three types PROJECT.md already names (migration 0008).
 * The functional engine and the approval queue are Phase 4 — no logic here.
 */
export const agentActionCatalog = pgTable(
  "agent_action_catalog",
  {
    code: text("code").primaryKey(),
    label: text("label").notNull(),
    riskLevel: text("risk_level").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "agent_action_catalog_risk_level_check",
      sql`${table.riskLevel} in ('low', 'high')`,
    ),
  ],
);
