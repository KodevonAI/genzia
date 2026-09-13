import { and, asc, eq } from "drizzle-orm";
import { authorizedContacts } from "@/lib/db/schema/authorized-contacts";
import { messages } from "@/lib/db/schema/messages";
import type { ResolvedIdentity } from "@/lib/identity/types";
import { withResolvedIdentityContext } from "@/lib/tenant/with-resolved-identity-context";
import { withSystemWebhookContext } from "@/lib/tenant/with-system-webhook-context";
import { sendWhatsAppTextMessage } from "@/lib/whatsapp/send-message";

/**
 * The shared delivery helper both tools need — sending a WhatsApp message to
 * the client's authorized contact and recording it in `messages`. This is
 * the ONLY place either tool touches `authorized_contacts` or `messages`, so
 * SEG-04's opt-in gate and the outbound persistence shape can't drift between
 * `send_payment_reminder` and `draft_client_content`.
 */
export type DeliverToClientResult =
  | { delivered: true; metaMessageId: string }
  | { delivered: false; reason: string };

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}

export async function deliverToClient(params: {
  agencyId: string;
  clientId: string;
  identity: ResolvedIdentity;
  body: string;
}): Promise<DeliverToClientResult> {
  const { agencyId, clientId, identity, body } = params;

  // Step 1: resolve the recipient FIRST, in the caller's own identity scope
  // (mirrors ingest-inbound-message.ts's ordering rule). SEG-04: never
  // message a contact the team has not attested opted in — `optInConfirmedByTeam`
  // is the team's own manual checkbox, not a Meta-verified opt-in round-trip.
  //
  // A `team_member`'s read here runs inside their own RLS scope. Whatever
  // that scope does or does not let a member see for an unassigned client is
  // enforced entirely by the database policy on `authorized_contacts` — this
  // function deliberately does not re-implement an assignment check of its
  // own, so the actual boundary can't drift out of sync with the policy.
  const [contact] = await withResolvedIdentityContext(
    agencyId,
    identity,
    (tx) =>
      tx
        .select({ phoneNumber: authorizedContacts.phoneNumber })
        .from(authorizedContacts)
        .where(
          and(
            eq(authorizedContacts.clientId, clientId),
            eq(authorizedContacts.optInConfirmedByTeam, true),
          ),
        )
        .orderBy(asc(authorizedContacts.createdAt))
        .limit(1),
  );

  if (!contact) {
    return {
      delivered: false,
      reason: "el cliente no tiene un contacto autorizado con opt-in confirmado",
    };
  }

  // Step 2: send.
  const { metaMessageId } = await sendWhatsAppTextMessage(
    contact.phoneNumber,
    body,
  );

  // Step 3: persist the outbound row, copying send-whatsapp-ack.ts's field
  // mapping exactly (system actor, swapped from/to, onConflictDoNothing on
  // the same partial unique index).
  const platformPhoneNumber = requiredEnv("META_WHATSAPP_PHONE_NUMBER_ID");
  const resolvedIdentityId =
    identity.type === "team_member"
      ? identity.teamMemberId
      : identity.type === "client_contact"
        ? identity.contactId
        : null;

  await withSystemWebhookContext(agencyId, async (tx) => {
    await tx
      .insert(messages)
      .values({
        agencyId,
        clientId,
        direction: "outbound",
        channel: "whatsapp",
        fromPhoneNumber: platformPhoneNumber,
        toPhoneNumber: contact.phoneNumber,
        metaMessageId,
        // Mirrors ResolvedIdentity["type"] exactly, same convention as the
        // inbound row this proactive send has no single inbound counterpart
        // to copy from (messages.ts's own header comment).
        resolvedIdentityType: identity.type,
        resolvedIdentityId,
        messageType: "text",
        textBody: body,
      })
      .onConflictDoNothing({
        target: [messages.agencyId, messages.metaMessageId],
      });
  });

  return { delivered: true, metaMessageId };
}
