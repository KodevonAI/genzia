import { Inngest, eventType, staticSchema } from "inngest";

/**
 * First Inngest integration in this repo. STACK.md selected Inngest as the
 * project's background-job engine; Phase 3 is the first real wiring, not a
 * new tool choice.
 *
 * Why the outbound send is a background function rather than inline in the
 * webhook: Meta retries any non-200 with exponential backoff for up to 7
 * days, so the webhook must answer fast and must be idempotent. The Graph
 * API send itself can fail transiently (rate limit, timeout), and D-01
 * exists specifically to prove outbound sending is RELIABLE before Phase 4
 * depends on it — Inngest's per-step retry is the behavior being proven,
 * not just "don't block the response".
 *
 * Follows the same singleton-export convention as lib/db/index.ts and
 * lib/tenant/with-tenant-context.ts: constructed once at module scope,
 * exported directly, no factory wrapper.
 *
 * Deviation from RESEARCH.md's exact code sample: `EventSchemas` /
 * `.fromRecord()` (the v3-style client-level typed-events API) does not
 * exist in `inngest@4.20.0` (verified directly against the installed
 * package's type declarations — `ClientOptions` has no `schemas` field,
 * and `node_modules/inngest/index.d.ts` exports no `EventSchemas`). 4.20.0
 * replaced it with a per-event `eventType(name, { schema })` +
 * `staticSchema<T>()` helper (`node_modules/inngest/components/triggers/
 * triggers.d.ts`). `staticSchema<T>()` gives compile-time-only typing with
 * no runtime validation — matching this repo's existing "no schema-
 * validation dependency" posture (RESEARCH.md §Alternatives Considered) —
 * while still producing the same binding contract: a typed `.create(data)`
 * for plan 03-05's send and a typed trigger for plan 03-06's consumer.
 */

/**
 * Payload of `whatsapp/message.received`. Everything the ack function needs
 * is carried on the event so it never has to re-read the inbound row (which
 * would require a second RLS-scoped round trip for no benefit).
 */
export type WhatsAppMessageReceivedData = {
  /** `messages.id` of the inbound row that was just persisted. */
  messageRowId: string;
  /** Tenant scope for every DB write the ack function performs. */
  agencyId: string;
  /** The WhatsApp number that sent the inbound message — the ack RECIPIENT. */
  senderPhoneNumber: string;
  /** The platform/agency number the message arrived on — the ack SENDER. */
  platformPhoneNumber: string;
  /** Mirrors ResolvedIdentity["type"] in lib/identity/types.ts exactly. */
  resolvedIdentityType: "team_member" | "client_contact" | "unknown";
  /** team_members.id, authorized_contacts.id, or null for `unknown`. */
  resolvedIdentityId: string | null;
  /** clients.id for a client_contact sender; null otherwise. */
  clientId: string | null;
  /** Mirrors messages.message_type — 'text' | 'image' | 'audio' | 'unsupported'. */
  messageType: "text" | "image" | "audio" | "unsupported";
  /** 'admin' | 'member' for a team_member sender, null otherwise. Required so
   *  process-agent-turn can rebuild the exact ResolvedIdentity — the role
   *  decides which RLS branch opens, and re-reading team_members inside a
   *  webhook scope is forbidden by withSystemWebhookContext's INVARIANT. */
  resolvedIdentityRole: "admin" | "member" | null;
  /** Meta media id for an image/audio message; null otherwise. Carried on the
   *  event so Phase 4's turn can download the bytes without a second
   *  RLS-scoped read of the row it was just told about. */
  mediaId: string | null;
  mediaMimeType: string | null;
};

/**
 * Phase 4 (plan 04-09): a human decision on a queued `approval_queue` row.
 * Defined here — not in a new module 04-09 would otherwise have to open
 * this same file for — because a second Inngest event type belongs next to
 * the first one, not scattered across files by which plan introduced it.
 *
 * LD-09: high-risk actions are replayed by a separate function listening on
 * this event, never by a suspended turn waiting on `step.waitForEvent` — a
 * turn's Inngest run does not stay alive across a human's approval delay.
 */
export type AgentApprovalDecidedData = {
  agencyId: string;
  approvalId: string;
  decision: "approved" | "rejected";
  decidedByTeamMemberId: string;
};

export const agentApprovalDecidedEvent = eventType("agent/approval.decided", {
  schema: staticSchema<AgentApprovalDecidedData>(),
});

/**
 * Typed event definition for `whatsapp/message.received` — the binding
 * contract between plan 03-05 (sends via `.create(data)`) and plan 03-06
 * (consumes via this as a function trigger, per `eventType`'s own doc
 * comment: "the primary way to define typed events" in this SDK version).
 */
export const whatsappMessageReceivedEvent = eventType("whatsapp/message.received", {
  schema: staticSchema<WhatsAppMessageReceivedData>(),
});

export const inngest = new Inngest({
  id: "genzia",
});
