import { sql } from "drizzle-orm";
import { messages } from "@/lib/db/schema/messages";
import { resolveIdentity } from "@/lib/identity/resolve-identity";
import type { ResolvedIdentity } from "@/lib/identity/types";
import { withSystemWebhookContext } from "@/lib/tenant/with-system-webhook-context";
import { toMessageType, type ParsedInboundMessage } from "./parse-webhook-payload";
import { resolveInboundAgency } from "./resolve-inbound-agency";

/**
 * One inbound WhatsApp message, from a signature-verified webhook payload to
 * a durable, idempotent row — with Phase 2's identity model applied. This is
 * the function the phase's success criterion is about.
 *
 * Ordering matters and is not arbitrary:
 *   1. resolveInboundAgency  — which tenant? (WA-03/WA-04; may be none)
 *   2. resolveIdentity       — who is the sender WITHIN that tenant? (Phase 2,
 *                              unchanged; opens its own read-only transaction
 *                              setting only app.agency_id)
 *   3. withSystemWebhookContext + insert ... on conflict do nothing
 *
 * Steps 1 and 2 both complete BEFORE the write transaction opens. That is
 * what keeps SEG-12 (02-07-SUMMARY.md) closed: the identity is already plain
 * data by the time the scope exists, so nothing inside the scope ever needs
 * to query `team_members` or `authorized_contacts`. Never move a lookup
 * inside the withSystemWebhookContext callback.
 *
 * Idempotency (Meta retries any non-200 with backoff for up to 7 days, so the
 * same payload WILL arrive more than once): the unique index
 * `messages_agency_id_meta_message_id_idx` plus ON CONFLICT DO NOTHING is the
 * dedup mechanism — the same durable pattern createAgencyFromClerkOrg already
 * uses for Clerk's at-least-once delivery. The caller must dispatch the
 * outbound ack ONLY on `outcome: "ingested"`, otherwise one message produces
 * two acks.
 */
export type IngestResult =
  | {
      outcome: "ingested";
      messageRowId: string;
      agencyId: string;
      identity: ResolvedIdentity;
    }
  | { outcome: "duplicate"; agencyId: string }
  | {
      outcome: "no_agency";
      reason: "unknown_sender_on_shared_number" | "unmapped_phone_number_id";
    };

/** authorized_contacts.id / team_members.id, or null for an unknown sender. */
function identityRowId(identity: ResolvedIdentity): string | null {
  if (identity.type === "team_member") return identity.teamMemberId;
  if (identity.type === "client_contact") return identity.contactId;
  return null;
}

/** Only a client contact is scoped to a client; team-internal chats are not. */
function identityClientId(identity: ResolvedIdentity): string | null {
  return identity.type === "client_contact" ? identity.clientId : null;
}

export async function ingestInboundMessage(
  message: ParsedInboundMessage,
  phoneNumberId: string,
  platformPhoneNumber: string,
): Promise<IngestResult> {
  const routed = await resolveInboundAgency(phoneNumberId, message.from);
  if (routed.kind === "no_agency") {
    console.warn(
      `Meta webhook: dropping message ${message.metaMessageId} — no agency (${routed.reason}, phone_number_id=${phoneNumberId}).`,
    );
    return { outcome: "no_agency", reason: routed.reason };
  }

  const agencyId = routed.agencyId;
  const identity = await resolveIdentity(agencyId, message.from);

  const inserted = await withSystemWebhookContext(agencyId, async (tx) => {
    const rows = await tx
      .insert(messages)
      .values({
        agencyId,
        clientId: identityClientId(identity),
        direction: "inbound",
        channel: "whatsapp",
        fromPhoneNumber: message.from,
        toPhoneNumber: platformPhoneNumber,
        metaMessageId: message.metaMessageId,
        resolvedIdentityType: identity.type,
        resolvedIdentityId: identityRowId(identity),
        messageType: toMessageType(message),
        textBody: message.kind === "text" ? message.text : null,
        mediaId: message.kind === "media" ? message.mediaId : null,
        mediaMimeType: message.kind === "media" ? message.mimeType : null,
      })
      .onConflictDoNothing({
        target: [messages.agencyId, messages.metaMessageId],
        // The unique index is partial (`where meta_message_id is not null`);
        // Postgres can only infer it as the ON CONFLICT arbiter when the
        // predicate is repeated here — omitting it makes every insert fail
        // with "no unique or exclusion constraint matching the ON CONFLICT
        // specification", not silently fall back to an unfiltered match.
        where: sql`${messages.metaMessageId} is not null`,
      })
      .returning({ id: messages.id });
    return rows[0];
  });

  if (!inserted) {
    // Duplicate delivery of a payload already processed. Returning early is
    // what prevents a second ack from being sent for the same message.
    return { outcome: "duplicate", agencyId };
  }

  return { outcome: "ingested", messageRowId: inserted.id, agencyId, identity };
}
