import type Anthropic from "@anthropic-ai/sdk";
import type { ResolvedIdentity } from "@/lib/identity/types";

/**
 * `ConversationKey` is the ONLY way a conversation is addressed in this
 * codebase (plan 04-04). A WhatsApp thread is identified by the
 * counterpart's phone number (the platform number is always the same,
 * per-agency, so it carries no information); a web thread is identified by
 * the team member's id PLUS a `threadId` (migration 0018 — superseding the
 * "one thread per member" half of LD-16, see that migration's header;
 * `teamMemberId` is kept alongside `threadId`, not dropped, because it is
 * still what `messages.resolvedIdentityId` and RLS ownership are keyed on).
 * LD-02 still holds: web chat is team-only, a client-facing web chat needs a
 * magic-link/OTP mechanism that belongs to the client-portal phase (POR-01).
 */
export type ConversationKey =
  | { channel: "whatsapp"; counterpartPhoneNumber: string }
  | { channel: "web"; teamMemberId: string; threadId: string };

/**
 * Everything one LLM turn needs, produced exclusively by
 * `lib/agent/build-context.ts`. Nothing else in the codebase is allowed to
 * read `messages` or `agent_brand_config` for agent purposes (see that
 * file's header comment).
 */
export type AgentContext = {
  system: string;
  tools: Anthropic.Messages.Tool[];
  messages: Anthropic.Messages.MessageParam[];
  /** The single client this turn is scoped to, or null for team-internal. */
  clientId: string | null;
};

/** Everything a tool's execute() and the risk interceptor need about the caller. */
export type TurnActor = {
  agencyId: string;
  identity: ResolvedIdentity;
  clientId: string | null;
  channel: "whatsapp" | "web";
  /** Where a reply/result should be delivered; null for web chat. */
  counterpartPhoneNumber: string | null;
};
