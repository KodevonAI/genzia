import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agencies } from "./agencies";
import { agentActionCatalog } from "./agent-action-catalog";
import { approvalQueue } from "./approval-queue";
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
 *
 * Plan 04-03 (SEG-10/SEG-11 shape gap): `status` distinguishes "the agent did
 * this" (`executed`, the historical default) from "the agent proposed this
 * and is waiting" (`pending_approval`) from "the team said no" (`rejected`),
 * plus `approved_executed`/`failed` for the two outcomes a decided proposal
 * can reach after plan 04-09 replays it. `approval_id` links a bitácora line
 * back to the `approval_queue` row it is about — nullable because most
 * `audit_log` rows (low-risk, already-executed actions) have no queue item at
 * all, and `ON DELETE SET NULL` because the bitácora line must survive the
 * queue row's own deletion.
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
    status: text("status").notNull().default("executed"),
    approvalId: uuid("approval_id").references(() => approvalQueue.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("audit_log_risk_level_check", sql`${table.riskLevel} in ('low', 'high')`),
    check(
      "audit_log_status_check",
      sql`${table.status} in ('executed', 'pending_approval', 'approved_executed', 'rejected', 'failed')`,
    ),
  ],
);
