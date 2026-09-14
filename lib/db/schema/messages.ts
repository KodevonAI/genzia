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
import { conversations } from "./conversations";

/**
 * Raw inbound/outbound WhatsApp message log (D-04). Deliberately separate
 * from `audit_log` (Phase 2) — `audit_log` is reserved for agent actions and
 * decisions in later phases (see 02-02-SUMMARY.md); this table is the
 * message transcript itself.
 *
 * Written exclusively through `withSystemWebhookContext` (Phase 3, DEC-A) for
 * the WhatsApp channel, never through `withResolvedIdentityContext`: the
 * webhook legitimately has to persist a message from an `unknown` sender, and
 * an `unknown` identity scope sets only `app.agency_id` — indistinguishable
 * at the GUC level from the SEG-12 read pattern 02-07-SUMMARY.md warns
 * against. The `app.actor` GUC makes the two distinguishable, so RLS can
 * allow one and deny the other.
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
 *
 * === Plan 04-10: the web channel ===
 *
 * `channel` gained a real CHECK ('whatsapp' | 'web') in migration 0017 — this
 * table was future-proofed for exactly this from the start (see the old
 * comment on the column itself, kept below). `fromPhoneNumber`/
 * `toPhoneNumber` are nullable as of 0017 because a web-chat message has no
 * phone numbers at all; the WhatsApp invariant that both must be present is
 * preserved as `messages_whatsapp_phone_numbers_check` (a CHECK), not by
 * column nullability — nullability alone cannot express "required only when
 * channel = 'whatsapp'".
 *
 * LD-16 (locked decision): a web conversation is keyed by `(agency_id,
 * channel = 'web', resolved_identity_id = the team member)` for identity
 * purposes. SUPERSEDED as of migration 0018 for the "one thread per team
 * member, no thread management UI" part specifically: `threadId` (below —
 * named to avoid colliding with the pre-existing `conversationId`, which is
 * Meta's own billing-conversation id and completely unrelated) now scopes a
 * web message to one of possibly several named threads that team member
 * owns. `client_id` still stays NULL on every web row: a team member talking
 * to the agent is still a team-internal conversation, and per LD-03 that
 * history is still visible to the whole team in the bitácora (see
 * `messages_select_by_role`, migration 0015, which is channel-agnostic and
 * needed no change for this).
 *
 * LD-02 (locked decision): the web chat is TEAM-ONLY in this phase,
 * authenticated by the Clerk session through `withTenantContext` — never
 * `withResolvedIdentityContext`. A client-facing web chat needs a
 * magic-link/OTP mechanism that exists nowhere in this codebase and belongs
 * to the client-portal phase (POR-01).
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
    // Future-proofs the web chat channel (SIS-01) — 0017 added the web
    // channel itself, constrained below by `messages_channel_check`.
    channel: text("channel").notNull().default("whatsapp"),
    // Nullable as of 0017: a web-chat message has no phone numbers at all.
    // The WhatsApp invariant (both must be present for that channel) is
    // enforced by `messages_whatsapp_phone_numbers_check` below, not by
    // column nullability.
    fromPhoneNumber: text("from_phone_number"),
    toPhoneNumber: text("to_phone_number"),
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
    // Migration 0018: which named `conversations` thread a web message
    // belongs to. Deliberately NOT named `conversationId` — that name was
    // already taken by Meta's own billing-conversation id above, a totally
    // different concept. Always NULL for whatsapp-channel rows; required
    // (see `messages_web_conversation_id_check` below) for web-channel rows.
    threadId: uuid("thread_id").references(() => conversations.id, { onDelete: "cascade" }),
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
    check("messages_channel_check", sql`${table.channel} in ('whatsapp', 'web')`),
    check(
      "messages_whatsapp_phone_numbers_check",
      sql`${table.channel} <> 'whatsapp' or (${table.fromPhoneNumber} is not null and ${table.toPhoneNumber} is not null)`,
    ),
    check(
      "messages_web_conversation_id_check",
      sql`${table.channel} <> 'web' or ${table.threadId} is not null`,
    ),
  ],
);
