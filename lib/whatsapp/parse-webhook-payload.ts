/**
 * Typed, throw-free reader for Meta WhatsApp Cloud API webhook payloads.
 *
 * No `server-only` import: scripts/verify-whatsapp-webhook-parsing.ts
 * imports this module under plain `tsx`. The module is pure — no I/O, no env
 * vars, no database.
 *
 * No zod. RESEARCH.md flagged it as a defensible but first-of-its-kind
 * dependency for this codebase; the decision is to stay consistent with the
 * repo's existing posture (signature verification is the trust boundary,
 * TypeScript types plus defensive narrowing shape the data) rather than
 * introduce the project's first runtime-validation dependency for one module.
 * The cost of that choice is paid here: every accessor below must narrow
 * defensively and this function must NEVER throw, because throwing on an
 * unexpected shape would turn one odd Meta payload into a 7-day retry loop.
 *
 * Shapes handled (all under entry[].changes[].value):
 *   value.messages[]  inbound messages   -> ParsedInboundMessage
 *   value.statuses[]  delivery receipts  -> ParsedStatusUpdate
 * Anything else is ignored, not an error.
 */

/** D-05: text is understood end to end; image/audio are detected and their
 *  Meta media_id stored, never downloaded or interpreted this phase. */
export type ParsedInboundMessage =
  | {
      kind: "text";
      from: string;
      metaMessageId: string;
      timestamp: string | null;
      text: string;
    }
  | {
      kind: "media";
      from: string;
      metaMessageId: string;
      timestamp: string | null;
      mediaType: "image" | "audio";
      mediaId: string;
      mimeType: string | null;
    }
  | {
      kind: "unsupported";
      from: string;
      metaMessageId: string;
      timestamp: string | null;
      rawType: string;
    };

/** Delivery receipt. `pricing*` and `conversationId` feed WA-07. */
export type ParsedStatusUpdate = {
  metaMessageId: string;
  recipientPhoneNumber: string;
  status: string;
  conversationId: string | null;
  pricingCategory: string | null;
  pricingBillable: boolean | null;
};

export type ParsedWebhookChange = {
  /** metadata.phone_number_id — which of OUR numbers received this. */
  phoneNumberId: string;
  /** metadata.display_phone_number, E.164-normalized. */
  displayPhoneNumber: string;
  messages: ParsedInboundMessage[];
  statuses: ParsedStatusUpdate[];
};

/**
 * Meta sends phone numbers WITHOUT a leading '+' ("573001110001"), while this
 * repo stores them WITH one (lib/team/invite-member.ts's
 * /^\+[1-9]\d{7,14}$/, matched with an exact eq() in
 * lib/identity/resolve-identity.ts). Skipping this normalization makes every
 * registered team member resolve as `unknown` — silently, with no error.
 */
export function normalizeToE164(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

/** Maps a parsed message to the `messages.message_type` CHECK values. */
export function toMessageType(
  message: ParsedInboundMessage,
): "text" | "image" | "audio" | "unsupported" {
  if (message.kind === "text") return "text";
  if (message.kind === "media") return message.mediaType;
  return "unsupported";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseMessage(raw: unknown): ParsedInboundMessage | null {
  if (!isRecord(raw)) return null;
  const from = asString(raw.from);
  const metaMessageId = asString(raw.id);
  const rawType = asString(raw.type) ?? "unknown";
  // Without a sender and a wamid there is nothing to resolve and nothing to
  // deduplicate on — drop it rather than write an unattributable row.
  if (!from || !metaMessageId) return null;

  const base = {
    from: normalizeToE164(from),
    metaMessageId,
    timestamp: asString(raw.timestamp),
  };

  if (rawType === "text") {
    const text = isRecord(raw.text) ? asString(raw.text.body) : null;
    return { kind: "text", ...base, text: text ?? "" };
  }

  if (rawType === "image" || rawType === "audio") {
    const media = isRecord(raw[rawType]) ? (raw[rawType] as Record<string, unknown>) : null;
    const mediaId = media ? asString(media.id) : null;
    // A media message with no media id carries nothing this phase can store,
    // so it degrades to `unsupported` rather than writing a null media_id.
    if (mediaId) {
      return {
        kind: "media",
        ...base,
        mediaType: rawType,
        mediaId,
        mimeType: media ? asString(media.mime_type) : null,
      };
    }
  }

  // video, document, sticker, location, contacts, reaction, button,
  // interactive, system, unknown — recorded as received, not interpreted.
  return { kind: "unsupported", ...base, rawType };
}

function parseStatus(raw: unknown): ParsedStatusUpdate | null {
  if (!isRecord(raw)) return null;
  const metaMessageId = asString(raw.id);
  const recipient = asString(raw.recipient_id);
  const status = asString(raw.status);
  if (!metaMessageId || !recipient || !status) return null;

  const conversation = isRecord(raw.conversation) ? raw.conversation : null;
  const pricing = isRecord(raw.pricing) ? raw.pricing : null;

  return {
    metaMessageId,
    recipientPhoneNumber: normalizeToE164(recipient),
    status,
    conversationId: conversation ? asString(conversation.id) : null,
    pricingCategory: pricing ? asString(pricing.category) : null,
    pricingBillable:
      pricing && typeof pricing.billable === "boolean" ? pricing.billable : null,
  };
}

export function parseMetaWebhookPayload(payload: unknown): ParsedWebhookChange[] {
  if (!isRecord(payload) || !Array.isArray(payload.entry)) return [];

  const changes: ParsedWebhookChange[] = [];

  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;

    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;
      const value = change.value;
      const metadata = isRecord(value.metadata) ? value.metadata : null;
      const phoneNumberId = metadata ? asString(metadata.phone_number_id) : null;
      // Without phone_number_id there is no way to know which of our numbers
      // received this, so there is no agency to route it to.
      if (!phoneNumberId) continue;

      const displayRaw = metadata ? asString(metadata.display_phone_number) : null;

      const messages = Array.isArray(value.messages)
        ? value.messages
            .map(parseMessage)
            .filter((m): m is ParsedInboundMessage => m !== null)
        : [];
      const statuses = Array.isArray(value.statuses)
        ? value.statuses
            .map(parseStatus)
            .filter((s): s is ParsedStatusUpdate => s !== null)
        : [];

      changes.push({
        phoneNumberId,
        displayPhoneNumber: displayRaw ? normalizeToE164(displayRaw) : "",
        messages,
        statuses,
      });
    }
  }

  return changes;
}
