import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agencies } from "./agencies";
import { clients } from "./clients";

/**
 * Raw inbound/outbound WhatsApp message log (D-04). Deliberately separate
 * from `audit_log` (Phase 2) — `audit_log` is reserved for agent actions and
 * decisions in later phases (see 02-02-SUMMARY.md); this table is the
 * message transcript itself.
 *
 * Written exclusively through `withSystemWebhookContext` (Phase 3, DEC-A),
 * never through `withResolvedIdentityContext`: the webhook legitimately has
 * to persist a message from an `unknown` sender, and an `unknown` identity
 * scope sets only `app.agency_id` — indistinguishable at the GUC level from
 * the SEG-12 read pattern 02-07-SUMMARY.md warns against. The `app.actor`
 * GUC makes the two distinguishable, so RLS can allow one and deny the other.
 *
 * `resolved_identity_type` mirrors `ResolvedIdentity["type"]` in
 * lib/identity/types.ts exactly — 'team_member' | 'client_contact' |
 * 'unknown'. Not a re-invented enum.
 *
 * `delivery_status` and the `conversation_id` / `pricing_*` columns are
 * populated from Meta's own `statuses[]` webhook payload (WA-07). They carry
 * NO CHECK constraint on purpose: Meta has added both statuses and pricing
 * categories mid-platform-life, and a CHECK here would turn a new upstream
 * value into a hard write failure inside a retry-until-success webhook loop.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: text("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    // Nullable: team-internal 1:1 conversations (WA-03) have no client.
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(),
    // Future-proofs the web chat channel (SIS-01) without a schema change —
    // this phase only ever writes 'whatsapp'.
    channel: text("channel").notNull().default("whatsapp"),
    fromPhoneNumber: text("from_phone_number").notNull(),
    toPhoneNumber: text("to_phone_number").notNull(),
    // Meta's wamid — the idempotency key. Nullable because a send that fails
    // before Meta assigns an id has no value; the unique index below is
    // partial and only applies where it is present.
    metaMessageId: text("meta_message_id"),
    resolvedIdentityType: text("resolved_identity_type").notNull(),
    resolvedIdentityId: uuid("resolved_identity_id"),
    messageType: text("message_type").notNull(),
    textBody: text("text_body"),
    // D-05: reference only. This phase never downloads media.
    mediaId: text("media_id"),
    mediaMimeType: text("media_mime_type"),
    // WA-07: filled from Meta's statuses[] delivery receipts (plan 03-07).
    deliveryStatus: text("delivery_status"),
    conversationId: text("conversation_id"),
    pricingCategory: text("pricing_category"),
    pricingBillable: boolean("pricing_billable"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("messages_agency_id_meta_message_id_idx")
      .on(table.agencyId, table.metaMessageId)
      .where(sql`${table.metaMessageId} is not null`),
    check(
      "messages_direction_check",
      sql`${table.direction} in ('inbound', 'outbound')`,
    ),
    check(
      "messages_resolved_identity_type_check",
      sql`${table.resolvedIdentityType} in ('team_member', 'client_contact', 'unknown')`,
    ),
    check(
      "messages_message_type_check",
      sql`${table.messageType} in ('text', 'image', 'audio', 'unsupported')`,
    ),
  ],
);
