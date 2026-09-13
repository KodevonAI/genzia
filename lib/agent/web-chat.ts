import "server-only";
import { sql } from "drizzle-orm";
import { buildAgentContextInScope } from "@/lib/agent/build-context";
import { interpretMedia } from "@/lib/agent/media-content";
import { runTurn, type TurnMediaInput } from "@/lib/agent/run-turn";
import { toolsFor } from "@/lib/agent/tools";
import type { TurnActor } from "@/lib/agent/types";
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
  const { context, agencyId, teamMemberId, role } = await withTenantContext(async (tx) => {
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
    });

    const identity = { type: "team_member" as const, teamMemberId: member.id, role: resolvedRole };

    const builtContext = await buildAgentContextInScope(
      tx,
      resolvedAgencyId,
      identity,
      { channel: "web", teamMemberId: member.id },
      toolsFor(identity),
    );

    return {
      context: builtContext,
      agencyId: resolvedAgencyId,
      teamMemberId: member.id,
      role: resolvedRole,
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
    key: { channel: "web", teamMemberId },
    currentTurnMedia,
    context,
  });

  // Step 4: persist the outbound row so it becomes history for the next turn.
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
    });
  });

  return { ok: true, replyText };
}
