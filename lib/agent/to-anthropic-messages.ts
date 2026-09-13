import type Anthropic from "@anthropic-ai/sdk";

type MessageParam = Anthropic.Messages.MessageParam;

/**
 * The subset of a `messages` row `toAnthropicMessages` needs. Deliberately a
 * plain, hand-shaped type (not `typeof messages.$inferSelect`) so this module
 * has zero database-layer imports — it is a pure function and the phase's
 * verification suite (plan 04-08) exercises it without a database.
 */
export type HistoryRow = {
  direction: string;
  messageType: string;
  textBody: string | null;
  mediaMimeType: string | null;
  createdAt: Date;
};

/**
 * Resolves the display text for one history row (LD-07): only the CURRENT
 * turn carries raw media bytes into the model, so every historical row is
 * rendered as text. `text_body` wins when present (it is also where plan
 * 04-05 writes an audio transcript back, so a transcribed voice note reads
 * exactly like a text message once it exists). Falling back on
 * `message_type` covers the image/audio/unsupported rows that have no
 * `text_body`. The function never returns an empty string — the Anthropic
 * Messages API rejects empty content blocks, and an empty history row would
 * otherwise silently break every turn that includes it.
 */
function resolveRowText(row: HistoryRow): string {
  if (row.textBody) return row.textBody;
  if (row.messageType === "image") return "[imagen enviada por el usuario]";
  if (row.messageType === "audio") return "[nota de voz sin transcripción]";
  return "[mensaje no soportado]";
}

/**
 * `direction === "inbound"` is always the human side of the conversation
 * (the client contact or team member who sent it) and maps to Anthropic's
 * `"user"` role; `"outbound"` is always something the agent said and maps to
 * `"assistant"`. This is a direct, permanent mapping — WA-03/WA-04 never
 * introduce a third direction.
 */
function roleForDirection(direction: string): "user" | "assistant" {
  return direction === "inbound" ? "user" : "assistant";
}

/**
 * Converts capped, chronologically-ordered `messages` rows into a strictly
 * alternating `MessageParam[]` for the Anthropic Messages API.
 *
 * Two rules exist purely to satisfy the API's "roles must strictly
 * alternate" requirement, which real WhatsApp traffic violates constantly:
 *
 * 1. Consecutive rows with the SAME role are merged into ONE message,
 *    joining their resolved texts with "\n". Two inbound WhatsApp messages
 *    in a row (someone sending a thought across two bubbles) is the normal
 *    case here, not an edge case — without merging, the API would reject the
 *    whole request with a 400 on almost every real conversation.
 * 2. If the first message after merging is `assistant` (e.g. the window cap
 *    landed mid-conversation right after something the agent said), it is
 *    dropped: a conversation sent to the API must start with a `user` turn.
 */
export function toAnthropicMessages(rows: HistoryRow[]): MessageParam[] {
  const merged: MessageParam[] = [];

  for (const row of rows) {
    const role = roleForDirection(row.direction);
    const text = resolveRowText(row);
    const last = merged[merged.length - 1];

    if (last && last.role === role) {
      // Same role as the previous row: merge instead of appending, per the
      // alternating-roles requirement above.
      last.content = `${last.content as string}\n${text}`;
    } else {
      merged.push({ role, content: text });
    }
  }

  if (merged.length > 0 && merged[0].role === "assistant") {
    merged.shift();
  }

  return merged;
}
