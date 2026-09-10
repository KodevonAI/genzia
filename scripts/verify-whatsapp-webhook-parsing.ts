/**
 * Network-free half of Phase 3's test matrix for the WhatsApp webhook trust
 * boundary and payload parser (the real-Neon half is
 * `scripts/verify-whatsapp-webhook.ts`). Covers T-03-01 (forged payload),
 * T-03-02 (timing attack) and D-05 (media detection without download).
 *
 * No database, no Meta credentials, no network — must run in a sandboxed
 * session. Run with `npx tsx scripts/verify-whatsapp-webhook-parsing.ts`.
 */
import { createHmac } from "node:crypto";
import { verifyMetaWebhookSignature } from "../lib/webhooks/verify-meta-signature";
import {
  parseMetaWebhookPayload,
  toMessageType,
  type ParsedInboundMessage,
} from "../lib/whatsapp/parse-webhook-payload";

const failures: string[] = [];

function check(label: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`  [PASS] ${label}`);
  } else {
    console.log(`  [FAIL] ${label} — ${detail}`);
    failures.push(`${label} — ${detail}`);
  }
}

/**
 * `err` from a driver/RLS/trigger failure is always an `Error` in practice,
 * but this stays defensive rather than assuming it.
 */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function expectThrowsSync(label: string, fn: () => void, expectedFragment: string) {
  try {
    fn();
    check(label, false, "expected an error, but the call succeeded");
  } catch (err) {
    const message = errorMessage(err);
    check(label, message.includes(expectedFragment), `error did not mention "${expectedFragment}": ${message}`);
  }
}

const META_PHONE_NUMBER_ID = "123456789012345";
const DISPLAY_NUMBER = "15550001111";
const SENDER = "573001110001";

function envelope(value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA-1", changes: [{ field: "messages", value }] }],
  };
}

const baseMetadata = {
  messaging_product: "whatsapp",
  metadata: { display_phone_number: DISPLAY_NUMBER, phone_number_id: META_PHONE_NUMBER_ID },
};

const textFixture = envelope({
  ...baseMetadata,
  contacts: [{ profile: { name: "Ana" }, wa_id: SENDER }],
  messages: [{ from: SENDER, id: "wamid.TEXT1", timestamp: "1789000000", type: "text", text: { body: "hola" } }],
});

const imageFixture = envelope({
  ...baseMetadata,
  messages: [
    {
      from: SENDER,
      id: "wamid.IMG1",
      timestamp: "1789000001",
      type: "image",
      image: { mime_type: "image/jpeg", sha256: "abc", id: "media-img-1" },
    },
  ],
});

const audioFixture = envelope({
  ...baseMetadata,
  messages: [
    {
      from: SENDER,
      id: "wamid.AUD1",
      timestamp: "1789000002",
      type: "audio",
      audio: { mime_type: "audio/ogg; codecs=opus", sha256: "def", id: "media-aud-1", voice: true },
    },
  ],
});

const videoFixture = envelope({
  ...baseMetadata,
  messages: [
    {
      from: SENDER,
      id: "wamid.VID1",
      timestamp: "1789000003",
      type: "video",
      video: { mime_type: "video/mp4", sha256: "ghi", id: "media-vid-1" },
    },
  ],
});

const statusFixture = envelope({
  ...baseMetadata,
  statuses: [
    {
      id: "wamid.OUT1",
      status: "delivered",
      timestamp: "1789000100",
      recipient_id: SENDER,
      conversation: { id: "conv-abc", origin: { type: "service" } },
      pricing: { billable: false, pricing_model: "PMP", category: "service" },
    },
  ],
});

async function main() {
  process.env.META_APP_SECRET = "test-app-secret-for-verification";

  console.log("Running verifyMetaWebhookSignature assertions (T-03-01 / T-03-02)...");

  const body = JSON.stringify(textFixture);
  const validHex = createHmac("sha256", process.env.META_APP_SECRET).update(body, "utf8").digest("hex");

  // (1) valid signature verifies without throwing
  try {
    verifyMetaWebhookSignature(body, `sha256=${validHex}`);
    check("(1) T-03-01: a correctly signed body verifies without throwing", true, "");
  } catch (err) {
    check("(1) T-03-01: a correctly signed body verifies without throwing", false, errorMessage(err));
  }

  // (2) null header
  expectThrowsSync(
    "(2) T-03-01: null signature header throws",
    () => verifyMetaWebhookSignature(body, null),
    "Missing or malformed",
  );

  // (3) missing sha256= prefix
  expectThrowsSync(
    "(3) T-03-01: header without 'sha256=' prefix throws",
    () => verifyMetaWebhookSignature(body, "abc123"),
    "Missing or malformed",
  );

  // (4) same-length-but-wrong hex signature
  const wrongSameLengthHex = validHex.slice(0, -1) + (validHex.endsWith("0") ? "1" : "0");
  expectThrowsSync(
    "(4) T-03-01: same-length wrong signature throws Signature mismatch.",
    () => verifyMetaWebhookSignature(body, `sha256=${wrongSameLengthHex}`),
    "Signature mismatch.",
  );

  // (5) shorter hex signature must not surface a timingSafeEqual length error
  try {
    verifyMetaWebhookSignature(body, "sha256=deadbeef");
    check("(5) T-03-02: shorter signature throws Signature mismatch.", false, "expected an error, but the call succeeded");
  } catch (err) {
    const message = errorMessage(err);
    check(
      "(5) T-03-02: shorter signature throws Signature mismatch.",
      message.includes("Signature mismatch."),
      `error did not mention "Signature mismatch.": ${message}`,
    );
    check(
      "(5b) T-03-02: shorter signature error does not leak a timingSafeEqual length error",
      !message.toLowerCase().includes("length"),
      `error message unexpectedly mentions "length": ${message}`,
    );
  }

  // (6) one-character-different body, same signature
  const tamperedBody = body.slice(0, -1) + (body.endsWith("}") ? " }" : "}");
  expectThrowsSync(
    "(6) T-03-01: tampered body with the original signature throws Signature mismatch.",
    () => verifyMetaWebhookSignature(tamperedBody, `sha256=${validHex}`),
    "Signature mismatch.",
  );

  // (7) META_APP_SECRET unset
  {
    const saved = process.env.META_APP_SECRET;
    delete process.env.META_APP_SECRET;
    expectThrowsSync(
      "(7) META_APP_SECRET unset throws with See .env.example.",
      () => verifyMetaWebhookSignature(body, `sha256=${validHex}`),
      "See .env.example.",
    );
    process.env.META_APP_SECRET = saved;
  }

  console.log("\nRunning parseMetaWebhookPayload assertions (WA-05 / D-05)...");

  // (8)/(9)/(10) textFixture
  const textChanges = parseMetaWebhookPayload(textFixture);
  const textChange = textChanges[0];
  const textMessage = textChange?.messages[0];
  check(
    "(8) textFixture: 1 change, phoneNumberId matches, 1 text message",
    textChanges.length === 1 &&
      textChange?.phoneNumberId === META_PHONE_NUMBER_ID &&
      textChange?.messages.length === 1 &&
      textMessage?.kind === "text" &&
      textMessage.text === "hola",
    `got ${JSON.stringify(textChanges)}`,
  );
  check(
    '(9) textFixture: from === "+573001110001" (Meta sends no leading +)',
    textMessage?.kind === "text" && textMessage.from === "+573001110001",
    `got ${JSON.stringify(textMessage)}`,
  );
  check(
    '(10) textFixture: displayPhoneNumber === "+15550001111"',
    textChange?.displayPhoneNumber === "+15550001111",
    `got ${JSON.stringify(textChange)}`,
  );

  // (11) imageFixture
  const imageMessage = parseMetaWebhookPayload(imageFixture)[0]?.messages[0];
  check(
    "(11) imageFixture: kind media, mediaType image, mediaId + mimeType set, no text property",
    imageMessage?.kind === "media" &&
      imageMessage.mediaType === "image" &&
      imageMessage.mediaId === "media-img-1" &&
      imageMessage.mimeType === "image/jpeg" &&
      !("text" in imageMessage),
    `got ${JSON.stringify(imageMessage)}`,
  );

  // (12) audioFixture
  const audioMessage = parseMetaWebhookPayload(audioFixture)[0]?.messages[0];
  check(
    "(12) audioFixture: kind media, mediaType audio, mediaId set",
    audioMessage?.kind === "media" && audioMessage.mediaType === "audio" && audioMessage.mediaId === "media-aud-1",
    `got ${JSON.stringify(audioMessage)}`,
  );

  // (13) videoFixture
  const videoMessage = parseMetaWebhookPayload(videoFixture)[0]?.messages[0];
  check(
    "(13) videoFixture: kind unsupported, rawType video",
    videoMessage?.kind === "unsupported" && videoMessage.rawType === "video",
    `got ${JSON.stringify(videoMessage)}`,
  );

  // (14) toMessageType for the four fixtures
  check(
    "(14) toMessageType returns text/image/audio/unsupported for the four fixtures",
    textMessage !== undefined &&
      imageMessage !== undefined &&
      audioMessage !== undefined &&
      videoMessage !== undefined &&
      toMessageType(textMessage) === "text" &&
      toMessageType(imageMessage) === "image" &&
      toMessageType(audioMessage) === "audio" &&
      toMessageType(videoMessage) === "unsupported",
    `got ${JSON.stringify({
      text: textMessage && toMessageType(textMessage),
      image: imageMessage && toMessageType(imageMessage),
      audio: audioMessage && toMessageType(audioMessage),
      video: videoMessage && toMessageType(videoMessage),
    })}`,
  );

  // (15)/(16) statusFixture
  const statusChanges = parseMetaWebhookPayload(statusFixture);
  const statusChange = statusChanges[0];
  const status = statusChange?.statuses[0];
  check(
    "(15) statusFixture: 1 change, 0 messages, 1 status",
    statusChanges.length === 1 && statusChange?.messages.length === 0 && statusChange?.statuses.length === 1,
    `got ${JSON.stringify(statusChanges)}`,
  );
  check(
    "(16) statusFixture: pricingCategory service, pricingBillable false, conversationId conv-abc, recipient +573001110001, status delivered",
    status?.pricingCategory === "service" &&
      status?.pricingBillable === false &&
      status?.conversationId === "conv-abc" &&
      status?.recipientPhoneNumber === "+573001110001" &&
      status?.status === "delivered",
    `got ${JSON.stringify(status)}`,
  );

  // (17) robustness against malformed payloads
  const malformedPayloads: unknown[] = [
    null,
    undefined,
    {},
    { entry: "nope" },
    { entry: [{}] },
    { entry: [{ changes: [{ value: {} }] }] },
    envelope({ ...baseMetadata, messages: "nope" }),
  ];
  let malformedTotalMessages = 0;
  let malformedThrew = false;
  for (const payload of malformedPayloads) {
    try {
      const changes = parseMetaWebhookPayload(payload);
      malformedTotalMessages += changes.reduce((sum, c) => sum + c.messages.length, 0);
    } catch {
      malformedThrew = true;
    }
  }
  check(
    "(17) malformed payloads never throw and yield 0 total parsed messages",
    !malformedThrew && malformedTotalMessages === 0,
    `threw=${malformedThrew}, totalMessages=${malformedTotalMessages}`,
  );

  // (18) message with no id is dropped
  const noIdChanges = parseMetaWebhookPayload(
    envelope({ ...baseMetadata, messages: [{ from: SENDER, type: "text", text: { body: "x" } }] }),
  );
  check(
    "(18) message with no id is dropped, not written as an unattributable row",
    (noIdChanges[0]?.messages.length ?? 0) === 0,
    `got ${JSON.stringify(noIdChanges)}`,
  );

  // (19) image message with no image.id degrades to unsupported
  const noMediaIdChanges = parseMetaWebhookPayload(
    envelope({
      ...baseMetadata,
      messages: [{ from: SENDER, id: "wamid.IMGNOID", type: "image", image: { mime_type: "image/jpeg" } }],
    }),
  );
  const noMediaIdMessage = noMediaIdChanges[0]?.messages[0] as ParsedInboundMessage | undefined;
  check(
    "(19) image message with no image.id degrades to kind unsupported",
    noMediaIdMessage?.kind === "unsupported",
    `got ${JSON.stringify(noMediaIdMessage)}`,
  );

  console.log("");
  if (failures.length > 0) {
    console.log(`${failures.length} assertion(s) FAILED:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log("All assertions passed.");
  }
}

main().catch((err) => {
  console.error("verify-whatsapp-webhook-parsing.ts crashed:", err);
  process.exitCode = 1;
});
