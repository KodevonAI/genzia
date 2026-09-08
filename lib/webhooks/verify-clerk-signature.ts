import "server-only";
import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/backend";

/**
 * Verifies a Clerk webhook request against `CLERK_WEBHOOK_SECRET` using
 * Svix's standard-webhooks signature scheme, then returns the parsed event.
 *
 * This MUST run before anything else touches the request body — the raw,
 * unparsed body is what the signature was computed over, so parsing it
 * first (e.g. via `request.json()`) and re-serializing would break
 * verification for any payload whose JSON round-trip isn't byte-identical.
 *
 * Throws on any failure (missing headers, missing secret, bad signature,
 * expired timestamp) — callers must treat a thrown error as "reject this
 * request, do not touch the database."
 */
export class ClerkWebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClerkWebhookVerificationError";
  }
}

export function verifyClerkWebhookSignature(
  rawBody: string,
  headers: {
    "svix-id": string | null;
    "svix-timestamp": string | null;
    "svix-signature": string | null;
  },
): WebhookEvent {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    throw new ClerkWebhookVerificationError(
      "CLERK_WEBHOOK_SECRET is not set. See .env.example.",
    );
  }

  const svixId = headers["svix-id"];
  const svixTimestamp = headers["svix-timestamp"];
  const svixSignature = headers["svix-signature"];

  if (!svixId || !svixTimestamp || !svixSignature) {
    throw new ClerkWebhookVerificationError(
      "Missing svix-id/svix-timestamp/svix-signature headers.",
    );
  }

  const webhook = new Webhook(secret);

  // Throws `WebhookVerificationError` (from `svix`/`standardwebhooks`) on a
  // bad or missing signature, an expired timestamp, or a replayed id.
  webhook.verify(rawBody, {
    "svix-id": svixId,
    "svix-timestamp": svixTimestamp,
    "svix-signature": svixSignature,
  });

  return JSON.parse(rawBody) as WebhookEvent;
}
