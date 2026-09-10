import { messages } from "@/lib/db/schema/messages";
import { withSystemWebhookContext } from "@/lib/tenant/with-system-webhook-context";
import { sendWhatsAppTextMessage } from "@/lib/whatsapp/send-message";
import { inngest } from "@/inngest/client";

/**
 * D-01's outbound proof. The webhook receives a real message, resolves
 * identity, and the system sends a real reply through Meta's send API — not
 * just a 200 OK to the webhook. That is what demonstrates outbound sending
 * works (permissions, body format, rate limits, retry) BEFORE Phase 4 depends
 * on it for actual agent responses.
 *
 * Explicitly NOT in this phase: any LLM call, any response generation, any
 * branching on message content. The ack is one fixed string (D-01). Phase 4
 * replaces this function's body with the real agent loop; the event contract,
 * the retry shape and the persistence path stay.
 *
 * Two side effects, two named steps, on purpose: Inngest memoizes each
 * completed `step.run` result, so a retry after the DB write fails does NOT
 * re-send the WhatsApp message (which would deliver a duplicate to a real
 * person's phone). Wrapping both in one step would make that impossible.
 * This is also why there is no hand-rolled retry loop anywhere in this
 * phase — `step.run` already provides it (RESEARCH.md Don't Hand-Roll).
 *
 * Deviation from the plan's literal code sample: `inngest.createFunction()`
 * in the installed `inngest@4.20.0` takes exactly two arguments — an options
 * object (trigger merged in as `triggers: [{ event }]`) and the handler — not
 * the three-argument `(options, trigger, handler)` v3-era shape the plan's
 * sample used. Confirmed against this version's own doc-comment example in
 * `node_modules/inngest/lambda.d.ts` (`triggers: [{ event: "..." }]` inside
 * the same options object). Same category of SDK-version mismatch as
 * `inngest/client.ts`'s `EventSchemas`/`.fromRecord()` deviation
 * (`03-02-SUMMARY.md`); the binding contract itself (function id, retry
 * count, triggering event name, step shape) is unchanged.
 */

/** D-01: fixed content. Do not make this dynamic in this phase. */
export const ACK_TEXT = "Mensaje recibido";

export const sendWhatsAppAck = inngest.createFunction(
  {
    id: "send-whatsapp-ack",
    retries: 3,
    triggers: [{ event: "whatsapp/message.received" }],
  },
  async ({ event, step }) => {
    const {
      agencyId,
      senderPhoneNumber,
      platformPhoneNumber,
      resolvedIdentityType,
      resolvedIdentityId,
      clientId,
      messageRowId,
    } = event.data;

    const { metaMessageId } = await step.run("send-ack-via-graph-api", () =>
      sendWhatsAppTextMessage(senderPhoneNumber, ACK_TEXT),
    );

    await step.run("persist-outbound-row", () =>
      withSystemWebhookContext(agencyId, async (tx) => {
        await tx
          .insert(messages)
          .values({
            agencyId,
            clientId,
            direction: "outbound",
            channel: "whatsapp",
            // The platform/agency number is the sender of an outbound message
            // and the recipient of the inbound one — these two are swapped
            // relative to the inbound row on purpose.
            fromPhoneNumber: platformPhoneNumber,
            toPhoneNumber: senderPhoneNumber,
            metaMessageId,
            // The outbound row carries the SAME resolved identity as the
            // inbound one it answers (Open Question 1 in RESEARCH.md, resolved
            // in favour of reuse): `direction` already disambiguates who sent
            // what, and one logical exchange stays attributable to one person.
            resolvedIdentityType,
            resolvedIdentityId,
            messageType: "text",
            textBody: ACK_TEXT,
          })
          .onConflictDoNothing({
            target: [messages.agencyId, messages.metaMessageId],
          });
      }),
    );

    return { metaMessageId, inReplyTo: messageRowId };
  },
);
