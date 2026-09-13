/**
 * Authenticated, two-step download of WhatsApp media bytes from Meta's
 * Graph API (WA-05). Phase 3 deliberately stored only `media_id` /
 * `media_mime_type` and never downloaded anything (D-05) — this module
 * closes that gap.
 *
 * Meta's media contract is two requests, BOTH carrying Genzia's own bearer
 * token:
 *   1. GET /{version}/{media-id}?phone_number_id={id} -> { url, mime_type, file_size }
 *   2. GET {url} -> the actual bytes
 * The url from step 1 expires in 5 minutes and requires the SAME
 * Authorization header on step 2 — this is precisely why the url can never
 * be handed to the model as a `source: {type: "url"}` content block: the
 * model's own fetcher has no way to attach Genzia's token, so it would get
 * a 401 from Meta. The bytes must be fetched server-side and passed to the
 * model as base64 (see lib/agent/media-content.ts).
 *
 * Both steps must happen within the same execution (never split across an
 * Inngest step boundary), since the url expires in 5 minutes.
 *
 * This module deliberately has no guard against being imported outside a
 * server context: scripts/verify-agent-media.ts imports it under plain
 * `tsx` to assert the request shape against a stubbed fetch, exactly like
 * lib/whatsapp/send-message.ts documents for the same reason. The module is
 * still unusable in a browser — it reads a secret from process.env.
 */
import { GRAPH_API_VERSION } from "./send-message";

export const MEDIA_LIMITS = {
  audio: {
    maxBytes: 16 * 1024 * 1024,
    mimeTypes: ["audio/mpeg", "audio/aac", "audio/amr", "audio/mp4", "audio/ogg"],
  },
  image: {
    maxBytes: 5 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png"],
  },
} as const;

type MediaFamily = keyof typeof MEDIA_LIMITS;

export type DownloadedMedia = {
  buffer: Buffer;
  mimeType: string;
  byteLength: number;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}

/** Maps a mime type to the family whose size limit applies, defaulting to
 * the more permissive `audio` limit for a mime type this repo doesn't
 * enumerate — Meta only ever sends types it documents for `image`/`audio`
 * messages, so this branch is a defensive fallback, not the common path. */
function familyForMimeType(mimeType: string): MediaFamily {
  if (MEDIA_LIMITS.image.mimeTypes.includes(mimeType as never)) return "image";
  return "audio";
}

function assertWithinLimit(mediaId: string, mimeType: string, byteLength: number): void {
  const family = familyForMimeType(mimeType);
  const max = MEDIA_LIMITS[family].maxBytes;
  if (byteLength > max) {
    throw new Error(`Media ${mediaId} is ${byteLength} bytes, over the ${family} limit of ${max}`);
  }
}

export async function downloadMedia(mediaId: string): Promise<DownloadedMedia> {
  const accessToken = requiredEnv("META_WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = requiredEnv("META_WHATSAPP_PHONE_NUMBER_ID");

  // Step 1: resolve the media id to a temporary, authenticated download URL.
  const lookupResponse = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}?phone_number_id=${phoneNumberId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!lookupResponse.ok) {
    // Status + Meta's own error body, never the request headers.
    const errorBody = await lookupResponse.text();
    throw new Error(`Meta media lookup failed (${lookupResponse.status}): ${errorBody}`);
  }

  const lookupJson = (await lookupResponse.json()) as {
    url: string;
    mime_type: string;
    file_size?: number;
  };

  // Reject before spending a download: Meta's step-1 metadata already
  // reports file_size when available, so an oversized file never reaches
  // step 2 (T-04-21).
  if (typeof lookupJson.file_size === "number") {
    assertWithinLimit(mediaId, lookupJson.mime_type, lookupJson.file_size);
  }

  // Step 2: the SAME Authorization header is required on this request too —
  // Meta's temporary media URL is not a public URL, it is still gated by
  // the bearer token. This is why the url cannot be handed to the model as
  // a `source: {type: "url"}` content block: the model's fetcher cannot
  // attach Genzia's token, so Meta would answer with a 401.
  const bytesResponse = await fetch(lookupJson.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!bytesResponse.ok) {
    const errorBody = await bytesResponse.text();
    throw new Error(`Meta media download failed (${bytesResponse.status}): ${errorBody}`);
  }

  const buffer = Buffer.from(await bytesResponse.arrayBuffer());
  // Meta's file_size is advisory; re-check against the real byte length.
  assertWithinLimit(mediaId, lookupJson.mime_type, buffer.byteLength);

  return { buffer, mimeType: lookupJson.mime_type, byteLength: buffer.byteLength };
}
