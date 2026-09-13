import type Anthropic from "@anthropic-ai/sdk";
import type { TurnActor } from "@/lib/agent/types";
import type { ResolvedIdentity } from "@/lib/identity/types";
import * as draftClientContent from "./draft-client-content";
import * as sendPaymentReminder from "./send-payment-reminder";

/**
 * The tool registry (LD-06): exactly two executable tools this phase, both
 * backed by infrastructure that already exists. `reschedule_appointment`
 * (the catalog's third seeded code) gets no entry here — there is no
 * calendar to reschedule against until a later phase, and migration 0008's
 * own comment forbids inventing a stub for an action the agent cannot
 * actually perform.
 */
type AgentTool = {
  definition: Anthropic.Messages.Tool;
  catalogCode: string;
  execute: (input: unknown, actor: TurnActor) => Promise<string>;
};

export const AGENT_TOOLS: readonly AgentTool[] = [
  sendPaymentReminder,
  draftClientContent,
] as const;

/**
 * LD-12: tool availability is decided by identity, not by prompt. A
 * `client_contact` and an `unknown` sender get an empty array — the agent
 * converses with them, it does not act on their behalf. This is why a
 * client contact literally cannot emit a `tool_use` block: no tool is ever
 * offered to Claude in the first place for that turn.
 */
export function toolsFor(identity: ResolvedIdentity): Anthropic.Messages.Tool[] {
  if (identity.type === "team_member") {
    return AGENT_TOOLS.map((tool) => tool.definition);
  }
  return [];
}

/**
 * Looks a tool up by name and runs it. A miss returns a message rather than
 * throwing, so one bad or hallucinated tool name cannot abort the whole
 * turn — the model just sees that its own tool name was not recognized.
 */
export async function executeTool(
  name: string,
  input: unknown,
  actor: TurnActor,
): Promise<string> {
  const tool = AGENT_TOOLS.find((candidate) => candidate.definition.name === name);
  if (!tool) {
    return `Herramienta desconocida: ${name}`;
  }
  return tool.execute(input, actor);
}
