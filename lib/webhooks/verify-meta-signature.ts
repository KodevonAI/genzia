import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta's twin of lib/webhooks/verify-clerk-signature.ts. Same responsibility
 * (verify before parse, throw a typed error on any failure), different
 * primitive: Meta signs with a plain HMAC-SHA256 of the raw request body
 * under the app secret, delivered as `X-Hub-Signature-256: sha256=<hex>`.
 *
 * Returns void, unlike the Clerk version which returns the parsed event —
 * svix needs the parsed shape internally, this does not. The route handler
 * does its own JSON.parse AFTER calling this, which keeps the "verify the
 * exact bytes, only then parse" ordering visible at the call site.
 *
 * The comparison MUST be timingSafeEqual, never `===`: a byte-at-a-time
 * string comparison leaks the expected signature through response timing,
 * which is a cheap and well-known attack against webhook secrets.
 */
export class MetaWebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaWebhookVerificationError";
  }
}

export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): void {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    throw new MetaWebhookVerificationError(
      "META_APP_SECRET is not set. See .env.example.",
    );
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    throw new MetaWebhookVerificationError(
      "Missing or malformed X-Hub-Signature-256 header.",
    );
  }

  const expected = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");

  // timingSafeEqual THROWS on differing lengths, so the length check has to
  // come first — and it is not itself a leak, since the expected length is a
  // fixed public constant (32 bytes for SHA-256).
  if (
    expectedBuf.length !== providedBuf.length ||
    !timingSafeEqual(expectedBuf, providedBuf)
  ) {
    throw new MetaWebhookVerificationError("Signature mismatch.");
  }
}
