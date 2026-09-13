import { sql } from "drizzle-orm";
import {
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agencies } from "./agencies";
import { agentActionCatalog } from "./agent-action-catalog";
import { clients } from "./clients";
import { teamMembers } from "./team-members";

/**
 * The table SEG-10 needs and Phase 2 deliberately did not create
 * (02-02-SUMMARY.md): Phase 2 shipped only the static `agent_action_catalog`
 * (three seeded rows) and the `audit_log` shell; the engine, the queue and
 * the UI were all explicitly deferred to Phase 4. This is the queue.
 *
 * `risk_level` is a SNAPSHOT copied at proposal time, not a live join to
 * `agent_action_catalog.risk_level` — same rationale as `audit_log`'s: a
 * later re-classification of an action type must not rewrite the meaning of
 * history already sitting in the queue or the bitácora.
 *
 * LD-09's replay-ability rationale: high-risk actions are NOT executed by a
 * suspended Inngest function waiting on an event. The turn that proposes them
 * finishes immediately, and a separate function (plan 04-09) executes the
 * action when a human decides. That is why this table carries everything
 * needed to replay the tool call later — `tool_name`, `tool_input`,
 * `client_id`, `conversation_phone_number`, `channel` — not just a reference
 * to a live run that may no longer exist by the time a human responds.
 *
 * `status` is advanced by exactly two writers: the interceptor sets it to
 * `pending` at proposal time, and plan 04-09's approval-execution function
 * sets it to `executed`/`failed` after replay. The Server Action a human
 * calls (plan 04-09) only ever moves `pending` -> `approved`/`rejected`; it
 * never sets `executed`/`failed` itself — that only happens after the replay
 * function has actually run the tool call.
 */
export const approvalQueue = pgTable(
  "approval_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: text("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    // Nullable: null = agency-internal action, no specific client involved.
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    actionTypeCode: text("action_type_code")
      .notNull()
      .references(() => agentActionCatalog.code),
    riskLevel: text("risk_level").notNull(),
    toolName: text("tool_name").notNull(),
    // Claude's tool_use.id — the idempotency key. A retried Inngest step must
    // not enqueue the same proposal twice (see the unique index below).
    toolUseId: text("tool_use_id").notNull(),
    toolInput: jsonb("tool_input").notNull(),
    status: text("status").notNull().default("pending"),
    summary: text("summary").notNull(),
    requestedByIdentityType: text("requested_by_identity_type").notNull(),
    requestedByIdentityId: uuid("requested_by_identity_id"),
    channel: text("channel").notNull().default("whatsapp"),
    // Where the result should be delivered once decided; null for web.
    conversationPhoneNumber: text("conversation_phone_number"),
    decidedByTeamMemberId: uuid("decided_by_team_member_id").references(
      () => teamMembers.id,
    ),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    // Filled by plan 04-09 after replaying the tool call.
    executionResult: text("execution_result"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("approval_queue_agency_id_tool_use_id_idx").on(
      table.agencyId,
      table.toolUseId,
    ),
    check("approval_queue_risk_level_check", sql`${table.riskLevel} in ('low', 'high')`),
    check(
      "approval_queue_status_check",
      sql`${table.status} in ('pending', 'approved', 'rejected', 'executed', 'failed')`,
    ),
    check(
      "approval_queue_requested_by_identity_type_check",
      sql`${table.requestedByIdentityType} in ('team_member', 'client_contact', 'unknown')`,
    ),
    check(
      "approval_queue_channel_check",
      sql`${table.channel} in ('whatsapp', 'web')`,
    ),
  ],
);
