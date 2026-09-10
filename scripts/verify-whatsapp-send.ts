/**
 * Asserts the SHAPE of the outbound Graph API request (D-01, WA-01) without
 * spending a real Meta send or requiring network access — every assertion
 * runs against a capturing `fetch` stub. The live round-trip is the manual
 * checkpoint in plan 03-08.
 *
 * Run with `npx tsx scripts/verify-whatsapp-send.ts` (also wired as
 * `npm run verify:whatsapp-send` by plan 03-02).
 *
 * RESEARCH.md's Don't-Hand-Roll posture applies to the stub too: no mocking
 * library. `globalThis.fetch` is reassigned to a capturing function for the
 * duration of each call, then restored in a `finally`.
 */
import { sendWhatsAppTextMessage, GRAPH_API_VERSION } from "../lib/whatsapp/send-message";

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
  responder: (url: string, init: RequestInit) => Response,
  fn: (captured: CapturedCall[]) => Promise<T>,
): Promise<T> {
  const captured: CapturedCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    captured.push({ url, init: init ?? {} });
    return responder(url, init ?? {});
  }) as typeof globalThis.fetch;
  try {
    return await fn(captured);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function okResponse(metaMessageId: string): Response {
  return new Response(
    JSON.stringify({
      messaging_product: "whatsapp",
      contacts: [{ input: "573001110001", wa_id: "573001110001" }],
      messages: [{ id: metaMessageId }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
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

async function main() {
  process.env.META_WHATSAPP_PHONE_NUMBER_ID = "123456789012345";
  process.env.META_WHATSAPP_ACCESS_TOKEN = "test-system-user-token";

  console.log(`Verifying against GRAPH_API_VERSION=${GRAPH_API_VERSION}\n`);
  console.log("Running happy-path assertions...");

  const capturedErrors: string[] = [];

  await withStubbedFetch(
    () => okResponse("wamid.OUT-TEST-1"),
    async (captured) => {
      const result = await sendWhatsAppTextMessage("+573001110001", "Mensaje recibido");

      check("(1) WA-01: exactly one fetch is issued", captured.length === 1, `got ${captured.length} fetch call(s)`);

      const call = captured[0];
      check(
        "(2) WA-01: URL is exactly the versioned Graph API messages endpoint",
        call?.url === "https://graph.facebook.com/v25.0/123456789012345/messages",
        `got ${call?.url}`,
      );

      check("(3) WA-01: method is POST", call?.init.method === "POST", `got ${call?.init.method}`);

      check(
        "(4) WA-01: Authorization header is a Bearer token with the access token",
        headerValue(call?.init ?? {}, "Authorization") === "Bearer test-system-user-token",
        `got ${headerValue(call?.init ?? {}, "Authorization")}`,
      );

      check(
        "(5) WA-01: Content-Type header is application/json",
        headerValue(call?.init ?? {}, "Content-Type") === "application/json",
        `got ${headerValue(call?.init ?? {}, "Content-Type")}`,
      );

      const expectedBody = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "+573001110001",
        type: "text",
        text: { body: "Mensaje recibido" },
      };
      const actualBodyRaw = call?.init.body;
      const actualBody =
        typeof actualBodyRaw === "string" ? (JSON.parse(actualBodyRaw) as unknown) : actualBodyRaw;
      check(
        "(6) WA-01: JSON body matches the documented shape exactly",
        JSON.stringify(actualBody) === JSON.stringify(expectedBody),
        `got ${JSON.stringify(actualBody)}, expected ${JSON.stringify(expectedBody)}`,
      );

      check(
        "(7) WA-01: return value carries Meta's message id",
        result.metaMessageId === "wamid.OUT-TEST-1",
        `got ${JSON.stringify(result)}`,
      );
    },
  );

  console.log("\nRunning failure-path assertions...");

  await withStubbedFetch(
    () =>
      new Response(JSON.stringify({ error: { message: "Recipient not in allowed list" } }), {
        status: 400,
      }),
    async () => {
      try {
        await sendWhatsAppTextMessage("+573009990009", "Mensaje recibido");
        check("(8) A 400 response throws", false, "expected an error, but the call succeeded");
      } catch (err) {
        const message = errorMessage(err);
        capturedErrors.push(message);
        check(
          "(8) A 400 response throws with status and Meta's error body",
          message.includes("400") && message.includes("Recipient not in allowed list"),
          `got: ${message}`,
        );
      }
    },
  );

  await withStubbedFetch(
    () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token" } }), { status: 401 }),
    async () => {
      try {
        await sendWhatsAppTextMessage("+573001110001", "Mensaje recibido");
        check("(9) A 401 response throws", false, "expected an error, but the call succeeded");
      } catch (err) {
        const message = errorMessage(err);
        capturedErrors.push(message);
        check("(9) A 401 response throws with the status", message.includes("401"), `got: ${message}`);
      }
    },
  );

  console.log("\nRunning missing-credential assertions...");

  const savedAccessToken = process.env.META_WHATSAPP_ACCESS_TOKEN;
  delete process.env.META_WHATSAPP_ACCESS_TOKEN;
  await withStubbedFetch(
    () => okResponse("wamid.SHOULD-NOT-BE-CALLED"),
    async (captured) => {
      try {
        await sendWhatsAppTextMessage("+573001110001", "Mensaje recibido");
        check("(10) Missing access token throws", false, "expected an error, but the call succeeded");
      } catch (err) {
        const message = errorMessage(err);
        check(
          "(10) Missing META_WHATSAPP_ACCESS_TOKEN throws naming the variable, zero fetches issued",
          message.includes("META_WHATSAPP_ACCESS_TOKEN is not set. See .env.example.") && captured.length === 0,
          `message=${message}, fetches=${captured.length}`,
        );
      }
    },
  );
  process.env.META_WHATSAPP_ACCESS_TOKEN = savedAccessToken;

  const savedPhoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  await withStubbedFetch(
    () => okResponse("wamid.SHOULD-NOT-BE-CALLED"),
    async (captured) => {
      try {
        await sendWhatsAppTextMessage("+573001110001", "Mensaje recibido");
        check("(11) Missing phone number id throws", false, "expected an error, but the call succeeded");
      } catch (err) {
        const message = errorMessage(err);
        check(
          "(11) Missing META_WHATSAPP_PHONE_NUMBER_ID throws naming the variable, zero fetches issued",
          message.includes("META_WHATSAPP_PHONE_NUMBER_ID is not set.") && captured.length === 0,
          `message=${message}, fetches=${captured.length}`,
        );
      }
    },
  );
  process.env.META_WHATSAPP_PHONE_NUMBER_ID = savedPhoneNumberId;

  console.log("\nRunning token-leak assertion...");
  check(
    "(12) No thrown error message ever contains the access token",
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
  console.error("verify-whatsapp-send.ts crashed:", err);
  process.exitCode = 1;
});
