import { sql } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { runTurn, type TurnMediaInput } from "@/lib/agent/run-turn";
import type { TurnActor } from "@/lib/agent/types";
import { messages } from "@/lib/db/schema/messages";
import type { ResolvedIdentity } from "@/lib/identity/types";
import { withSystemWebhookContext } from "@/lib/tenant/with-system-webhook-context";
import { downloadMedia } from "@/lib/whatsapp/media";
import { interpretMedia, type InterpretedMedia } from "@/lib/agent/media-content";
import { sendWhatsAppTextMessage } from "@/lib/whatsapp/send-message";

/**
 * The real agent turn (WA-05, SEG-09, SEG-10, SIS-01, SEG-05) — replaces
 * `send-whatsapp-ack.ts`'s fixed `"Mensaje recibido"` string. Honours that
 * function's own header literally: the event contract, the retry shape and
 * the persistence path are extended here, not rebuilt.
 *
 * Same options shape, same reasoning for named steps: Inngest memoizes each
 * completed `step.run`, so a retry after a later step fails (e.g. the DB
 * write in `persist-outbound-row`) does NOT re-send the WhatsApp reply
 * (which would deliver a duplicate to a real person's phone) or re-run the
 * agent turn itself (which would waste an LLM call and could re-execute a
 * tool). Five named steps, one side effect each — never inline a step's
 * work directly in the handler outside `step.run`.
 *
 * EXACTLY ONE Inngest function is triggered by `whatsapp/message.received`
 * after this file exists: `send-whatsapp-ack.ts`'s own `createFunction` call
 * was removed for exactly this reason — two would double-reply to a real
 * person's phone.
 */

/** team_members.id / authorized_contacts.id, or null for `unknown` — the
 * inverse of app/api/webhooks/meta/route.ts's identityRowId. */
function reconstructIdentity(data: {
  resolvedIdentityType: "team_member" | "client_contact" | "unknown";
  resolvedIdentityId: string | null;
  resolvedIdentityRole: "admin" | "member" | null;
  clientId: string | null;
}): ResolvedIdentity {
  if (data.resolvedIdentityType === "team_member") {
    return {
      type: "team_member",
      teamMemberId: data.resolvedIdentityId!,
      role: data.resolvedIdentityRole!,
    };
  }
  if (data.resolvedIdentityType === "client_contact") {
    return {
      type: "client_contact",
      contactId: data.resolvedIdentityId!,
      clientId: data.clientId!,
      // Unused on this read path — buildAgentContext never checks it.
      // deliverToClient re-derives the real opt-in state from
      // authorized_contacts itself before any outbound message, so a stale
      // or wrong value here can never let an un-opted-in contact be
      // messaged proactively.
      optInConfirmedByTeam: true,
    };
  }
  return { type: "unknown" };
}

export const processAgentTurn = inngest.createFunction(
  {
    id: "process-agent-turn",
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
      resolvedIdentityRole,
      clientId,
      messageRowId,
      messageType,
      mediaId,
      // mediaMimeType is carried on the event for a future consumer (e.g. a
      // failed-download retry path); this function re-derives the real mime
      // type from Meta's own media-lookup response inside downloadMedia
      // instead of trusting the flat event value, so it is not read here.
    } = event.data;

    // Step 1: media interpretation. Both Meta calls (media lookup + byte
    // download) happen inside this ONE step because the media URL Meta
    // returns expires in 5 minutes and must not straddle a step boundary —
    // an Inngest retry could otherwise resume after the url already died.
    let interpreted: InterpretedMedia | null = null;
    if (mediaId) {
      interpreted = await step.run("interpret-media", async () => {
        try {
          const media = await downloadMedia(mediaId);
          return await interpretMedia(media);
        } catch (err) {
          // A media problem degrades the turn instead of killing it — the
          // person still gets an answer that honestly says the file could
          // not be processed (T-04-38).
          console.error("process-agent-turn: media interpretation failed", err);
          return {
            kind: "text",
            text: "[no se pudo procesar el archivo recibido]",
          } as const;
        }
      });
    }

    // Step 2: persist the transcript back onto the inbound row (LD-07), only
    // for an audio message that produced text in step 1. This is why later
    // turns — and this same turn's own history read in step 3 — see words
    // instead of a placeholder.
    if (messageType === "audio" && interpreted?.kind === "text") {
      const transcript = interpreted.text;
      await step.run("persist-transcript", () =>
        withSystemWebhookContext(agencyId, async (tx) => {
          await tx
            .update(messages)
            .set({ textBody: transcript })
            .where(sql`${messages.id} = ${messageRowId}`);
        }),
      );
    }

    // Step 3: the bounded agent turn itself, under the sender's own RLS
    // scope (buildAgentContext, inside runTurn, opens
    // withResolvedIdentityContext for this exact identity). Never re-read
    // team_members here — that is exactly what withSystemWebhookContext's
    // INVARIANT forbids, which is why the webhook route (task 2) put the
    // role flat on the event instead.
    const identity = reconstructIdentity({
      resolvedIdentityType,
      resolvedIdentityId,
      resolvedIdentityRole,
      clientId,
    });

    const actor: TurnActor = {
      agencyId,
      identity,
      clientId,
      channel: "whatsapp",
      counterpartPhoneNumber: senderPhoneNumber,
    };

    const currentTurnMedia: TurnMediaInput | null =
      interpreted?.kind === "image" ? { kind: "image", block: interpreted.block } : null;

    const { replyText, iterations } = await step.run("run-agent-turn", () =>
      runTurn({
        actor,
        key: { channel: "whatsapp", counterpartPhoneNumber: senderPhoneNumber },
        currentTurnMedia,
      }),
    );

    // Step 4: deliver the reply through the existing Graph API sender.
    const { metaMessageId } = await step.run("send-reply-via-graph-api", () =>
      sendWhatsAppTextMessage(senderPhoneNumber, replyText),
    );

    // Step 5: persist the outbound row so it becomes history for the next
    // turn (SIS-01). Field mapping copied from send-whatsapp-ack.ts
    // verbatim except `textBody: replyText`: the platform/agency number is
    // the sender of an outbound message and the recipient of the inbound
    // one (swapped on purpose), and the outbound row reuses the SAME
    // resolved identity as the inbound one it answers. The ON CONFLICT
    // target repeats the partial-index predicate
    // (`messages_agency_id_meta_message_id_idx`'s `WHERE meta_message_id IS
    // NOT NULL`) — Postgres cannot infer a partial index as an ON CONFLICT
    // arbiter without it, the real bug 03-08 found and fixed.
    await step.run("persist-outbound-row", () =>
      withSystemWebhookContext(agencyId, async (tx) => {
        await tx
          .insert(messages)
          .values({
            agencyId,
            clientId,
            direction: "outbound",
            channel: "whatsapp",
            fromPhoneNumber: platformPhoneNumber,
            toPhoneNumber: senderPhoneNumber,
            metaMessageId,
            resolvedIdentityType,
            resolvedIdentityId,
            messageType: "text",
            textBody: replyText,
          })
          .onConflictDoNothing({
            target: [messages.agencyId, messages.metaMessageId],
            where: sql`${messages.metaMessageId} is not null`,
          });
      }),
    );

    return { metaMessageId, inReplyTo: messageRowId, iterations };
  },
);
