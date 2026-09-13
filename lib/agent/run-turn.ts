import type Anthropic from "@anthropic-ai/sdk";
import { buildAgentContext } from "./build-context";
import { getAnthropicClient, reportLlmFailure, reportLlmSuccess } from "./client";
import { MODEL_FOR_TASK } from "./model-for-task";
import { classifyAndExecute } from "./risk-interceptor";
import { toolsFor } from "./tools";
import type { AgentContext, ConversationKey, TurnActor } from "./types";

/**
 * The agent's actual brain: a bounded, sequential tool-use loop composed
 * from `build-context.ts` (04-04, the ONLY reader of `messages`/
 * `agent_brand_config`), `tools/index.ts` + `risk-interceptor.ts` (04-06,
 * the SEG-10 gate every proposed tool call passes through) and `client.ts`
 * (04-02, the single place an Anthropic SDK client is constructed).
 *
 * This module has no runtime import restricting it to the server-rendering
 * environment: the phase's verification scripts import it under plain
 * `tsx`, exactly like `lib/agent/client.ts` and
 * `lib/tenant/with-resolved-identity-context.ts` already document for the
 * same reason.
 *
 * LD-08: this turn is non-streaming. `runTurn` returns the complete reply
 * text — a tool-calling loop is not linearly streamable without a second
 * orchestration path, and neither the phase goal nor WA-05 asks for
 * token-by-token output. The same `runTurn` serves both WhatsApp (this plan)
 * and web chat (plan 04-10).
 */

/**
 * LD-13: when the model still wants a tool after the sixth call (loop index
 * `MAX_TOOL_ITERATIONS`), the loop stops and the agent replies with a plain
 * message saying it could not complete the request — never an infinite
 * loop, never a silent truncation with no reply (T-04-35).
 */
export const MAX_TOOL_ITERATIONS = 5;

/**
 * Bounds the cost and length of a single model call. A WhatsApp reply this
 * long is already well past what a person reads comfortably in one bubble.
 */
export const MAX_OUTPUT_TOKENS = 1024;

export type TurnMediaInput =
  | { kind: "text"; text: string }
  | { kind: "image"; block: Anthropic.Messages.ImageBlockParam };

/**
 * Returned after the bounded loop exhausts `MAX_TOOL_ITERATIONS` without the
 * model reaching a non-tool-use stop. Registered explicitly (SEG-09): the
 * agent never claims an action happened when it did not, and never leaves
 * the person waiting with silence — an empty WhatsApp send is itself a
 * Graph API error, and silence reads as a crash to the person on the other
 * end.
 */
const ITERATION_LIMIT_REPLY =
  "No pude completar esa solicitud en este momento. Ya quedó registrada y el equipo puede revisarla.";

/**
 * Guard for a normal completion whose joined text came back empty (the
 * model returned only non-text blocks, e.g. a lone tool_use it changed its
 * mind about, or an empty text block). Same non-empty-reply guarantee as
 * `ITERATION_LIMIT_REPLY` above, for the completion path instead of the
 * exhaustion path.
 */
const EMPTY_COMPLETION_REPLY = "Listo.";

/**
 * Merges the current turn's raw image bytes onto the message list built
 * from persisted history. The inbound row is already persisted and
 * therefore already present in `context.messages` as a text turn (its
 * placeholder text, per `to-anthropic-messages.ts`); only the raw image
 * bytes are not, which is why they are merged onto that same user turn
 * rather than pushed as a duplicate one. When the last message is not a
 * user turn (an edge case: the history window cap landed such that the
 * inbound row itself fell outside `HISTORY_MESSAGE_LIMIT`), a new user
 * message carrying just the image is pushed instead.
 */
function mergeCurrentTurnMedia(
  messages: Anthropic.Messages.MessageParam[],
  media: TurnMediaInput | null | undefined,
): void {
  if (!media || media.kind !== "image") return;

  const last = messages[messages.length - 1];
  if (last && last.role === "user") {
    const existingContent: Anthropic.Messages.ContentBlockParam[] =
      typeof last.content === "string"
        ? [{ type: "text", text: last.content }]
        : last.content;
    last.content = [...existingContent, media.block];
    return;
  }

  messages.push({ role: "user", content: [media.block] });
}

function joinTextBlocks(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export async function runTurn(params: {
  actor: TurnActor;
  key: ConversationKey;
  /** Extra content for THIS turn only — the current image block, if any. */
  currentTurnMedia?: TurnMediaInput | null;
  /** Pre-built context, for the web path which owns its own transaction. */
  context?: AgentContext;
}): Promise<{ replyText: string; iterations: number; provider: string }> {
  const { actor, key, currentTurnMedia, context: providedContext } = params;

  const context =
    providedContext ??
    (await buildAgentContext(actor.agencyId, actor.identity, key, toolsFor(actor.identity)));

  const messages: Anthropic.Messages.MessageParam[] = [...context.messages];
  mergeCurrentTurnMedia(messages, currentTurnMedia);

  let provider = "unknown";

  for (let i = 0; i <= MAX_TOOL_ITERATIONS; i++) {
    let res: Anthropic.Messages.Message;
    try {
      const anthropic = getAnthropicClient();
      provider = anthropic.provider;
      res = await anthropic.client.messages.create({
        model: MODEL_FOR_TASK.main,
        max_tokens: MAX_OUTPUT_TOKENS,
        // The system prompt is ALWAYS the top-level `system` field — never a
        // message entry using the system role inside `messages`. Folding it
        // into `messages` instead would defeat prompt caching, the exact
        // symptom RESEARCH.md Pitfall 3 warns about.
        system: context.system,
        tools: context.tools,
        messages,
      });
      reportLlmSuccess();
    } catch (err) {
      reportLlmFailure();
      // Rethrow so Inngest's own step retry (not a hand-rolled loop here)
      // sees the failure and retries the whole step.
      throw err;
    }

    if (res.stop_reason !== "tool_use") {
      const replyText = joinTextBlocks(res.content);
      return {
        replyText: replyText.length > 0 ? replyText : EMPTY_COMPLETION_REPLY,
        iterations: i,
        provider,
      };
    }

    // Keep the model's own tool_use content on the transcript before
    // answering it — the Messages API requires the assistant turn that
    // proposed the tool call to precede its tool_result.
    messages.push({ role: "assistant", content: res.content });

    const toolUseBlocks = res.content.filter(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
    );

    // Sequential, on purpose, never a concurrent fan-out: two tool calls
    // that each send a WhatsApp message must not interleave (T-04-36).
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      const result = await classifyAndExecute(toolUse, actor);
      toolResults.push(result);
    }

    messages.push({ role: "user", content: toolResults });
  }

  return { replyText: ITERATION_LIMIT_REPLY, iterations: MAX_TOOL_ITERATIONS, provider };
}
