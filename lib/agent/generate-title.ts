import "server-only";
import { getAnthropicClient, reportLlmFailure, reportLlmSuccess } from "./client";
import { MODEL_FOR_TASK } from "./model-for-task";

const MAX_TITLE_INPUT_CHARS = 500;
const FALLBACK_TITLE_CHARS = 40;

/**
 * Best-effort short title for a sidebar conversation (migration 0018), used
 * once — right after a thread's FIRST exchange, from `web-chat.ts`. Never on
 * the hot path a person is waiting on: callers fire this after already
 * responding, and a failure here must never surface as a chat error, only
 * fall back to a plain truncation of what the person typed.
 *
 * `import "server-only"`, matching `web-chat.ts` — this is only ever called
 * from that app-only path, never from the `tsx` verification scripts the
 * rest of `lib/agent/*` stays importable from.
 */
export async function generateConversationTitle(userText: string, replyText: string): Promise<string> {
  const truncatedUser = userText.slice(0, MAX_TITLE_INPUT_CHARS);
  const fallback =
    truncatedUser.trim().length > 0
      ? truncatedUser.trim().slice(0, FALLBACK_TITLE_CHARS)
      : "Nueva conversación";

  try {
    const { client } = getAnthropicClient();
    const res = await client.messages.create({
      model: MODEL_FOR_TASK.cheap,
      max_tokens: 20,
      system:
        "Generate a short title (3-6 words, no quotes, no trailing period) that summarizes this chat exchange. Reply with ONLY the title, in the same language as the exchange.",
      messages: [
        {
          role: "user",
          content: `User: ${truncatedUser}\n\nAssistant: ${replyText.slice(0, MAX_TITLE_INPUT_CHARS)}`,
        },
      ],
    });
    reportLlmSuccess();

    const text = res.content
      .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join(" ")
      .trim()
      .replace(/^["']|["']$/g, "");

    return text.length > 0 ? text.slice(0, FALLBACK_TITLE_CHARS) : fallback;
  } catch (err) {
    reportLlmFailure();
    console.error("generateConversationTitle failed, falling back to truncation:", err);
    return fallback;
  }
}
