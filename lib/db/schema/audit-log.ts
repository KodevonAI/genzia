import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agencies } from "./agencies";
import { agentActionCatalog } from "./agent-action-catalog";
import { clients } from "./clients";

/**
 * SCHEMA SHELL ONLY (D-01). Nothing in Phase 2 writes to this table and no UI
 * reads it — the visible bitácora (SEG-11) and the approval flow (SEG-10) are
 * Phase 4. It exists now so Phase 4 builds on a stable shape instead of
 * paying a migration cost mid-agent-work (RESEARCH.md Assumption A4).
 *
 * `risk_level` is a SNAPSHOT copied at log time, not a live join to
 * agent_action_catalog.risk_level — historical entries must not change
 * meaning if the catalog is re-classified later.
 *
 * `client_id` is nullable: some agent actions are agency-internal (team 1:1)
 * and scoped to no client. Append-only by intent — no unique index, no update
 * path planned.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: text("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    actionTypeCode: text("action_type_code")
      .notNull()
      .references(() => agentActionCatalog.code),
    riskLevel: text("risk_level").notNull(),
    summary: text("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("audit_log_risk_level_check", sql`${table.riskLevel} in ('low', 'high')`),
  ],
);
