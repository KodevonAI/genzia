/**
 * OpenRouter model slugs (vendor-prefixed), per STACK-OPENROUTER.md §3.
 * Switching model for a task is a one-line change here and nowhere else —
 * no call site should hardcode a model string.
 *
 * `cheap` is reserved for future summarisation/classification helpers; this
 * phase's turn loop (lib/agent/run-turn.ts) uses `main` exclusively.
 */
export const MODEL_FOR_TASK = {
  main: "deepseek/deepseek-v4.1-flash",
  cheap: "anthropic/claude-haiku-4-5",
} as const;

export type ModelTask = keyof typeof MODEL_FOR_TASK;
