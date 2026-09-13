import Anthropic from "@anthropic-ai/sdk";

/**
 * The single, auditable place an Anthropic SDK client is constructed
 * anywhere in this codebase (T-04-09). Getting this wrong — pointing at
 * OpenRouter's OpenAI-compatible `/api/v1` surface instead of its
 * Anthropic-compatible passthrough — silently destroys prompt caching with
 * no error: `messages[]` shape still "works," it's just slower and more
 * expensive, and nothing in a normal test run would ever catch it. That is
 * why this is isolated into one small module rather than constructed ad hoc
 * at call sites.
 *
 * LD-01 (locked at plan time, do not re-open as a spike or checkpoint): the
 * agent is hand-rolled against the raw `@anthropic-ai/sdk` pointed at
 * OpenRouter's Anthropic-compatible passthrough. The Vercel AI SDK
 * (`streamText`/`useChat`) is NOT adopted anywhere in this phase.
 * STACK-AGENT.md and STACK-OPENROUTER.md both argue for the native wire
 * format to preserve `cache_control` breakpoints and keep the SEG-05
 * boundary auditable; no source confirms `cache_control` survives a
 * repointed `baseURL` through `@ai-sdk/anthropic`; and STATE.md's
 * "Decisiones clave" already records "orquestación a mano" as a project
 * decision. STACK.md's generic mention of Vercel AI SDK for "chat en tiempo
 * real" is superseded by this, for this phase.
 *
 * Assumption A2 (04-RESEARCH.md): the passthrough base path
 * `https://openrouter.ai/api` was inferred from STACK-OPENROUTER.md and the
 * Anthropic SDK's `ANTHROPIC_BASE_URL` convention, NOT confirmed against a
 * live call. It must be confirmed against openrouter.ai/docs the first time
 * a real call is made (plan 04-12). If wrong, every LLM call fails loudly at
 * integration time (a 404/wrong-shape error), which is low risk compared to
 * a silent caching regression — but it is unverified today.
 *
 * Never `https://openrouter.ai/api/v1/chat/completions` — that is the
 * OpenAI-compatible surface and it silently drops `cache_control`.
 *
 * No `import "server-only"`: scripts/verify-agent.ts (plan 04-12) imports
 * the turn machinery under plain `tsx`, exactly like
 * lib/tenant/with-resolved-identity-context.ts and
 * lib/whatsapp/send-message.ts already document for the same reason —
 * `server-only` resolves to its throwing entrypoint under `tsx` and would
 * crash the verification run. The module is still unusable in a browser: it
 * reads secrets from process.env.
 */

/** [ASSUMPTION A2 — unverified against a real call, see header] */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api";

/**
 * T-04-10: OpenRouter has no SLA and 04-RESEARCH.md documents real 2026
 * outages. After this many consecutive reported failures, getAnthropicClient
 * switches to Anthropic's own endpoint — same request shape, since the
 * passthrough is the native Anthropic wire format, so no call-site code
 * needs to change for the fallback to work.
 */
const CONSECUTIVE_FAILURES_BEFORE_FALLBACK = 3;

let consecutiveFailures = 0;
let hasWarnedFallbackActive = false;
let hasWarnedNoFallbackProvisioned = false;

/** Call after an LLM call fails, before deciding whether to retry. */
export function reportLlmFailure(): void {
  consecutiveFailures += 1;
}

/** Call after any successful LLM call — resets the fallback state. */
export function reportLlmSuccess(): void {
  consecutiveFailures = 0;
  hasWarnedFallbackActive = false;
  hasWarnedNoFallbackProvisioned = false;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}

/**
 * The only function anywhere in this codebase that should construct an
 * Anthropic client. Defaults to the OpenRouter passthrough; falls back to
 * Anthropic's own endpoint after `CONSECUTIVE_FAILURES_BEFORE_FALLBACK`
 * reported failures, but only if `ANTHROPIC_API_KEY` is actually set —
 * degrade loudly, never silently no-op (RESEARCH.md Pitfall 5).
 */
export function getAnthropicClient(): {
  client: Anthropic;
  provider: "openrouter" | "anthropic";
} {
  const shouldAttemptFallback =
    consecutiveFailures >= CONSECUTIVE_FAILURES_BEFORE_FALLBACK;

  if (shouldAttemptFallback && process.env.ANTHROPIC_API_KEY) {
    if (!hasWarnedFallbackActive) {
      console.warn(
        `[lib/agent/client.ts] ${consecutiveFailures} consecutive OpenRouter failures — ` +
          "switching to the direct Anthropic endpoint until the next successful call.",
      );
      hasWarnedFallbackActive = true;
    }
    return {
      client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
      provider: "anthropic",
    };
  }

  if (shouldAttemptFallback && !process.env.ANTHROPIC_API_KEY) {
    if (!hasWarnedNoFallbackProvisioned) {
      console.warn(
        `[lib/agent/client.ts] ${consecutiveFailures} consecutive OpenRouter failures and no ` +
          "ANTHROPIC_API_KEY is set — no fallback is provisioned, staying on OpenRouter.",
      );
      hasWarnedNoFallbackProvisioned = true;
    }
  }

  return {
    client: new Anthropic({
      baseURL: OPENROUTER_BASE_URL,
      apiKey: requiredEnv("OPENROUTER_API_KEY"),
    }),
    provider: "openrouter",
  };
}
