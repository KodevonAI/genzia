import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { buildAgentContextInScope } from "@/lib/agent/build-context";
import { generateConversationTitle } from "@/lib/agent/generate-title";
import { interpretMedia } from "@/lib/agent/media-content";
import { runTurn, type TurnMediaInput } from "@/lib/agent/run-turn";
import { toolsFor } from "@/lib/agent/tools";
import type { TurnActor } from "@/lib/agent/types";
import { conversations } from "@/lib/db/schema/conversations";
import { messages } from "@/lib/db/schema/messages";
import { MEDIA_LIMITS } from "@/lib/whatsapp/media";
import { getCurrentTeamMember } from "@/lib/team/current-member";
import { withTenantContext } from "@/lib/tenant/with-tenant-context";

/**
 * The web-chat entry point (WA-05, SIS-01, LD-02, LD-08, LD-16, plan 04-10).
 * `import "server-only"` on purpose — unlike the other `lib/agent/*` modules
 * the phase's `tsx` verification scripts import directly, this one is
 * app-only: it calls `withTenantContext`, which is itself `server-only` and
 * depends on a live Clerk session.
 *
 * One `runTurn` serves both channels (LD-08): this file never talks to the
 * Anthropic client directly, and it builds context through
 * `buildAgentContextInScope` — the exact same reader `build-context.ts`'s
 * WhatsApp entry point (`buildAgentContext`) wraps, just opened inside a
 * `withTenantContext` transaction (Clerk session) instead of the
 * phone-resolved-identity scope the WhatsApp path uses.
 */

export type WebChatInput = {
  text: string;
  attachment?: { base64: string; mimeType: string } | null;
  /** Which sidebar conversation (migration 0018) this turn belongs to. */
  threadId: string;
};

export type WebChatResult = { ok: true; replyText: string } | { ok: false; error: string };

function assertWithinLimit(mimeType: string, byteLength: number): void {
  const family = mimeType.startsWith("audio/") ? "audio" : "image";
  const max = MEDIA_LIMITS[family].maxBytes;
  if (byteLength > max) {
    throw new Error(`El archivo adjunto supera el límite de ${family} (${max} bytes).`);
  }
}

export async function sendWebChatTurn(input: WebChatInput): Promise<WebChatResult> {
  const member = await getCurrentTeamMember();
  if (!member) {
    return { ok: false, error: "Tu cuenta todavía se está aprovisionando." };
  }

  // Step 1: interpret any attachment BEFORE opening a transaction — the same
  // reason ingest-inbound-message.ts resolves identity before its scope: an
  // unbounded-latency operation (Deepgram transcription, here) must never
  // hold a Postgres transaction open.
  let currentTurnMedia: TurnMediaInput | null = null;
  let messageType: "text" | "image" | "audio" = "text";
  let effectiveText = input.text;

  if (input.attachment) {
    const buffer = Buffer.from(input.attachment.base64, "base64");
    try {
      assertWithinLimit(input.attachment.mimeType, buffer.byteLength);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Archivo inválido." };
    }

    const interpreted = await interpretMedia({ buffer, mimeType: input.attachment.mimeType });
    if (input.attachment.mimeType.startsWith("audio/")) {
      messageType = "audio";
      // LD-07: the model sees words, and the stored row carries them so the
      // next turn has them too — same reasoning as process-agent-turn.ts's
      // persist-transcript step, just inline instead of a second write.
      if (interpreted.kind === "text") {
        effectiveText = effectiveText.length > 0 ? `${effectiveText}\n${interpreted.text}` : interpreted.text;
      }
    } else if (interpreted.kind === "image") {
      messageType = "image";
      currentTurnMedia = { kind: "image", block: interpreted.block };
    }
  }

  // Step 2: insert the inbound row and build the context inside ONE
  // withTenantContext transaction. Never call the LLM inside this
  // transaction (T-04-50) — an API call of unbounded latency must never
  // hold a Postgres transaction open.
  const { context, agencyId, teamMemberId, role, needsTitle } = await withTenantContext(async (tx) => {
    const { rows } = await tx.execute<{ agency_id: string | null; role: string | null }>(
      sql`SELECT current_setting('app.agency_id', true) AS agency_id, current_setting('app.role', true) AS role`,
    );
    const resolvedAgencyId = rows[0]?.agency_id ?? "";
    const resolvedRole = (rows[0]?.role ?? "member") as "admin" | "member";

    await tx.insert(messages).values({
      agencyId: resolvedAgencyId,
      clientId: null,
      direction: "inbound",
      channel: "web",
      fromPhoneNumber: null,
      toPhoneNumber: null,
      metaMessageId: null,
      resolvedIdentityType: "team_member",
      resolvedIdentityId: member.id,
      messageType,
      textBody: effectiveText,
      threadId: input.threadId,
    });

    // A NULL title means this is (still) the thread's first exchange — read
    // BEFORE the reply is known so the title-generation decision below is
    // based on the thread's state, not on anything this turn just wrote.
    const [conversationRow] = await tx
      .select({ title: conversations.title })
      .from(conversations)
      .where(and(eq(conversations.id, input.threadId), eq(conversations.agencyId, resolvedAgencyId)));

    const identity = { type: "team_member" as const, teamMemberId: member.id, role: resolvedRole };

    const builtContext = await buildAgentContextInScope(
      tx,
      resolvedAgencyId,
      identity,
      { channel: "web", teamMemberId: member.id, threadId: input.threadId },
      toolsFor(identity),
    );

    return {
      context: builtContext,
      agencyId: resolvedAgencyId,
      teamMemberId: member.id,
      role: resolvedRole,
      needsTitle: (conversationRow?.title ?? null) === null,
    };
  });

  // Step 3: the actual model call, strictly BETWEEN the two
  // withTenantContext blocks — never inside one.
  const actor: TurnActor = {
    agencyId,
    identity: { type: "team_member", teamMemberId, role },
    clientId: null,
    channel: "web",
    counterpartPhoneNumber: null,
  };

  const { replyText } = await runTurn({
    actor,
    key: { channel: "web", teamMemberId, threadId: input.threadId },
    currentTurnMedia,
    context,
  });

  // Step 4: persist the outbound row and bump the thread's updated_at (for
  // sidebar recency ordering) so both become history for the next turn.
  await withTenantContext(async (tx) => {
    await tx.insert(messages).values({
      agencyId,
      clientId: null,
      direction: "outbound",
      channel: "web",
      fromPhoneNumber: null,
      toPhoneNumber: null,
      metaMessageId: null,
      resolvedIdentityType: "team_member",
      resolvedIdentityId: teamMemberId,
      messageType: "text",
      textBody: replyText,
      threadId: input.threadId,
    });

    await tx
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(and(eq(conversations.id, input.threadId), eq(conversations.agencyId, agencyId)));
  });

  // Step 5: best-effort title generation, strictly OUTSIDE any transaction
  // (same "never call the LLM inside a transaction" rule step 3 already
  // follows) and strictly AFTER the reply is already persisted — a slow or
  // failed title call must never delay or break the turn the person is
  // waiting on.
  if (needsTitle) {
    const title = await generateConversationTitle(input.text, replyText);
    await withTenantContext(async (tx) => {
      await tx
        .update(conversations)
        .set({ title })
        .where(
          and(
            eq(conversations.id, input.threadId),
            eq(conversations.agencyId, agencyId),
            sql`${conversations.title} is null`,
          ),
        );
    });
  }

  return { ok: true, replyText };
}
