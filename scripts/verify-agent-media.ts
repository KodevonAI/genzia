/**
 * Asserts the SHAPE of the two-step WhatsApp media download and both
 * `interpretMedia` branches (WA-05) without spending a real Meta or
 * Deepgram call — every network assertion runs against a capturing
 * `globalThis.fetch` stub. Same harness style as
 * scripts/verify-whatsapp-send.ts: no mocking library,
 * `globalThis.fetch` is reassigned for the duration of each call, then
 * restored in a `finally`.
 *
 * Run with `npx tsx scripts/verify-agent-media.ts` (wired as
 * `npm run verify:agent-media` by plan 04-02).
 *
 * `DEEPGRAM_API_KEY` is deliberately left unset for assertion 8 — no real
 * Deepgram call is made anywhere in this script, matching this plan's
 * critical_environment_note (no live network call to Meta or Deepgram).
 */
import { downloadMedia, MEDIA_LIMITS } from "../lib/whatsapp/media";
import { interpretMedia } from "../lib/agent/media-content";

const failures: string[] = [];

function check(label: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`  [PASS] ${label}`);
  } else {
    console.log(`  [FAIL] ${label} — ${detail}`);
    failures.push(`${label} — ${detail}`);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type CapturedCall = { url: string; init: RequestInit };

async function withStubbedFetch<T>(
  responder: (url: string, init: RequestInit, callIndex: number) => Response,
  fn: (captured: CapturedCall[]) => Promise<T>,
): Promise<T> {
  const captured: CapturedCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    captured.push({ url, init: init ?? {} });
    return responder(url, init ?? {}, captured.length - 1);
  }) as typeof globalThis.fetch;
  try {
    return await fn(captured);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function headerValue(init: RequestInit, name: string): string | undefined {
  const headers = init.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return match?.[1];
  }
  const record = headers as Record<string, string>;
  const matchKey = Object.keys(record).find((key) => key.toLowerCase() === name.toLowerCase());
  return matchKey ? record[matchKey] : undefined;
}

const STUB_BODY_BYTES = Buffer.from("fake-media-bytes-for-verification");

function lookupResponse(overrides?: { file_size?: number; mime_type?: string }): Response {
  return new Response(
    JSON.stringify({
      url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/fake-url?token=abc",
      mime_type: overrides?.mime_type ?? "audio/ogg",
      file_size: overrides?.file_size ?? STUB_BODY_BYTES.byteLength,
      id: "MEDIA_1",
      messaging_product: "whatsapp",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function bytesResponse(): Response {
  return new Response(STUB_BODY_BYTES, { status: 200 });
}

async function main() {
  process.env.META_WHATSAPP_ACCESS_TOKEN = "test-system-user-token";
  process.env.META_WHATSAPP_PHONE_NUMBER_ID = "123456789012345";

  console.log("Verifying lib/whatsapp/media.ts downloadMedia()...\n");

  const capturedErrors: string[] = [];

  await withStubbedFetch(
    (_url, _init, callIndex) => (callIndex === 0 ? lookupResponse() : bytesResponse()),
    async (captured) => {
      const result = await downloadMedia("MEDIA_1");

      check("(1) exactly TWO fetches are issued", captured.length === 2, `got ${captured.length}`);

      const first = captured[0];
      check(
        "(2) first request URL contains /v25.0/MEDIA_1 and phone_number_id=",
        (first?.url.includes("/v25.0/MEDIA_1") ?? false) && (first?.url.includes("phone_number_id=") ?? false),
        `got ${first?.url}`,
      );

      check(
        "(3a) first request carries Authorization: Bearer <token>",
        headerValue(first?.init ?? {}, "Authorization") === "Bearer test-system-user-token",
        `got ${headerValue(first?.init ?? {}, "Authorization")}`,
      );

      const second = captured[1];
      check(
        "(3b) second (bytes) request ALSO carries Authorization: Bearer <token>",
        headerValue(second?.init ?? {}, "Authorization") === "Bearer test-system-user-token",
        `got ${headerValue(second?.init ?? {}, "Authorization")}`,
      );

      check(
        "(4) returned buffer bytes equal the stubbed body, mimeType matches",
        result.buffer.equals(STUB_BODY_BYTES) && result.mimeType === "audio/ogg",
        `byteLength=${result.byteLength}, mimeType=${result.mimeType}`,
      );
    },
  );

  console.log("\nVerifying pre-download size rejection (T-04-21)...");

  await withStubbedFetch(
    (_url, _init, callIndex) =>
      callIndex === 0 ? lookupResponse({ file_size: MEDIA_LIMITS.image.maxBytes + 1, mime_type: "image/png" }) : bytesResponse(),
    async (captured) => {
      try {
        await downloadMedia("MEDIA_OVERSIZED");
        check("(5) an over-limit file_size throws before downloading bytes", false, "expected an error, call succeeded");
      } catch (err) {
        const message = errorMessage(err);
        capturedErrors.push(message);
        check(
          "(5) an over-limit file_size throws, exactly ONE fetch issued",
          message.includes("over the image limit") && captured.length === 1,
          `message=${message}, fetches=${captured.length}`,
        );
      }
    },
  );

  console.log("\nVerifying credential-free error surfacing (T-04-22)...");

  await withStubbedFetch(
    () => new Response(JSON.stringify({ error: { message: "Unsupported media type" } }), { status: 400 }),
    async () => {
      try {
        await downloadMedia("MEDIA_BAD");
        check("(6) a non-OK step-1 response throws", false, "expected an error, call succeeded");
      } catch (err) {
        const message = errorMessage(err);
        capturedErrors.push(message);
        check(
          "(6) a non-OK step-1 response throws with status + Meta's error body, no token",
          message.includes("400") &&
            message.includes("Unsupported media type") &&
            !message.includes("test-system-user-token"),
          `got: ${message}`,
        );
      }
    },
  );

  console.log("\nVerifying lib/agent/media-content.ts interpretMedia()...");

  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);
  const imageResult = await interpretMedia({ buffer: pngBytes, mimeType: "image/png" });
  const roundTripped =
    imageResult.kind === "image" &&
    imageResult.block.source.type === "base64" &&
    Buffer.from((imageResult.block.source as { data: string }).data, "base64").equals(pngBytes);
  check(
    "(7) an image/png buffer returns kind=image, base64 data round-trips",
    imageResult.kind === "image" && roundTripped,
    `got ${JSON.stringify(imageResult).slice(0, 200)}`,
  );

  const savedDeepgramKey = process.env.DEEPGRAM_API_KEY;
  delete process.env.DEEPGRAM_API_KEY;
  const audioResult = await interpretMedia({
    buffer: Buffer.from("fake-ogg-bytes"),
    mimeType: "audio/ogg",
  });
  check(
    "(8) an audio/ogg buffer with no DEEPGRAM_API_KEY returns the labelled placeholder, never throws",
    audioResult.kind === "text" && audioResult.text === "[nota de voz recibida, no se pudo transcribir]",
    `got ${JSON.stringify(audioResult)}`,
  );
  if (savedDeepgramKey !== undefined) process.env.DEEPGRAM_API_KEY = savedDeepgramKey;

  console.log("\nRunning token-leak assertion across all captured errors...");
  check(
    "(9) no thrown error message ever contains the access token",
    capturedErrors.every((message) => !message.includes("test-system-user-token")),
    `captured errors: ${JSON.stringify(capturedErrors)}`,
  );

  console.log("");
  if (failures.length === 0) {
    console.log("All assertions passed.");
  } else {
    console.log(`${failures.length} assertion(s) failed:`);
    for (const f of failures) console.log(`  - ${f}`);
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("verify-agent-media.ts crashed:", err);
  process.exitCode = 1;
});
