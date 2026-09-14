import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, or } from "drizzle-orm";
import { agentBrandConfig } from "@/lib/db/schema/agent-brand-config";
import { messages } from "@/lib/db/schema/messages";
import type { ResolvedIdentity } from "@/lib/identity/types";
import {
  withResolvedIdentityContext,
  type IdentityTx,
} from "@/lib/tenant/with-resolved-identity-context";
import { buildSystemPrompt, type AgentBrand } from "./system-prompt";
import { toAnthropicMessages } from "./to-anthropic-messages";
import type { AgentContext, ConversationKey } from "./types";

/**
 * THE only function in this codebase permitted to read `messages` or
 * `agent_brand_config` for agent purposes (SEG-05/06/07/08). It is called
 * fresh on every single turn and its result is NEVER cached across turns —
 * caching it would silently reuse a scope/history snapshot from a moment
 * that may no longer reflect who is allowed to see what (T-04-20). Do not
 * add a module-level cache, a memoization wrapper, or a "reuse the last
 * context for this conversation" shortcut here or anywhere that calls this.
 *
 * The web-chat path (plan 04-10) calls `buildAgentContextInScope` directly
 * with a transaction opened by `withTenantContext` (Clerk-session based)
 * instead of `buildAgentContext`, because `withTenantContext` lives in a
 * module restricted to the server-rendering runtime that this file — and the
 * `tsx` verification scripts that must import it — cannot pull in. This file
 * deliberately omits that same runtime restriction, matching
 * `lib/tenant/with-resolved-identity-context.ts` and `lib/agent/client.ts`
 * for the same reason.
 */

/**
 * LD-05: history is capped at the most recent 40 messages of the
 * conversation, ordered by `created_at`. No token counting or
 * summarisation in this phase — a hard row cap is the cheapest defence
 * against an unbounded-cost, years-long WhatsApp thread (T-04-19) and it is
 * trivially verifiable. Exported so a later phase can replace the policy in
 * exactly one place.
 */
export const HISTORY_MESSAGE_LIMIT = 40;

/**
 * Core reader. Takes an ALREADY-SCOPED transaction — it never opens one
 * itself, so it can be reused by both the WhatsApp entry point below (which
 * opens `withResolvedIdentityContext`) and the web-chat path (which opens
 * `withTenantContext`, a helper restricted to the server-rendering runtime
 * that this module cannot import).
 */
export async function buildAgentContextInScope(
  tx: IdentityTx,
  agencyId: string,
  identity: ResolvedIdentity,
  key: ConversationKey,
  tools: Anthropic.Messages.Tool[],
): Promise<AgentContext> {
  // 1. Brand config. A missing row is normal (white-label fields are all
  // optional, CTA-02) — fall back to nulls rather than throwing.
  const [brandRow] = await tx
    .select({
      agentName: agentBrandConfig.agentName,
      tone: agentBrandConfig.tone,
    })
    .from(agentBrandConfig)
    .where(eq(agentBrandConfig.agencyId, agencyId));

  const brand: AgentBrand = brandRow ?? { agentName: null, tone: null };

  // 2. History. The predicates below are the ENTIRE scoping mechanism for
  // this query: `agency_id` plus a channel-specific conversation-identity
  // predicate. There is deliberately NO `client_id` predicate and NO role
  // branch here — adding one would be exactly the application-level client
  // filter SEG-05 rejects ("nunca por instrucción/filtro"), and worse, it
  // would silently mask a broken RLS policy instead of failing loudly. The
  // actual boundary is `messages_select_by_role` from migration 0015: a
  // client_contact's transaction only ever sees rows RLS lets it see, a
  // member's transaction only sees assigned-client + team-internal rows,
  // and an `unknown` scope (only `app.agency_id` set) matches no branch and
  // sees zero rows (SEG-12). If that policy ever regresses, this query must
  // return the wrong rows and fail the 04-08 assertions loudly — not quietly
  // narrow itself back down here.
  const conversationPredicate =
    key.channel === "whatsapp"
      ? and(
          eq(messages.channel, "whatsapp"),
          or(
            eq(messages.fromPhoneNumber, key.counterpartPhoneNumber),
            eq(messages.toPhoneNumber, key.counterpartPhoneNumber),
          ),
        )
      : and(
          eq(messages.channel, "web"),
          eq(messages.resolvedIdentityId, key.teamMemberId),
          // threadId scopes history to ONE sidebar conversation (migration
          // 0018). resolvedIdentityId is kept as a belt-and-suspenders
          // predicate, not relied on alone: RLS/ownership is still keyed on
          // it, and it's always true in tandem with threadId in practice.
          eq(messages.threadId, key.threadId),
        );

  const rows = await tx
    .select({
      direction: messages.direction,
      messageType: messages.messageType,
      textBody: messages.textBody,
      mediaMimeType: messages.mediaMimeType,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(eq(messages.agencyId, agencyId), conversationPredicate))
    .orderBy(desc(messages.createdAt))
    .limit(HISTORY_MESSAGE_LIMIT);

  // The query above is DESC (most recent first, to make LIMIT cap the right
  // end of a long thread); reverse in memory back to chronological order
  // before handing rows to toAnthropicMessages, which assumes chronological
  // input.
  const chronological = rows.slice().reverse();

  // 3. System prompt — identity/brand/scope, built entirely in
  // lib/agent/system-prompt.ts (plan 04-02), including the unconditional
  // SEG-09 disclosure rule.
  const system = buildSystemPrompt(identity, brand);

  // 4. Only a client_contact's turn is scoped to one client. A team member's
  // turn is not scoped to a single client — a tool call names the client
  // explicitly and the risk interceptor (plan 04-07) re-checks it against
  // that member's assignments.
  const clientId = identity.type === "client_contact" ? identity.clientId : null;

  return {
    system,
    tools,
    messages: toAnthropicMessages(chronological),
    clientId,
  };
}

/** WhatsApp/phone-resolved entry point: opens `withResolvedIdentityContext`. */
export async function buildAgentContext(
  agencyId: string,
  identity: ResolvedIdentity,
  key: ConversationKey,
  tools: Anthropic.Messages.Tool[],
): Promise<AgentContext> {
  return withResolvedIdentityContext(agencyId, identity, (tx) =>
    buildAgentContextInScope(tx, agencyId, identity, key, tools),
  );
}
