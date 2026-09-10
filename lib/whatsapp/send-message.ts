/**
 * Outbound WhatsApp send, straight to Meta's Graph API (WA-01: Genzia is a
 * direct Tech Provider — no BSP, and deliberately no WhatsApp SDK either).
 * The whole call is one fetch with a JSON body and a bearer header; an SDK
 * would be an abstraction layer over three lines, which is exactly the
 * tradeoff STACK-AGENT.md argues against elsewhere in this project.
 *
 * No `import "server-only"`: scripts/verify-whatsapp-send.ts imports this
 * module under plain `tsx` to assert the request shape against a stubbed
 * fetch (server-only resolves to its throwing entrypoint there). The module
 * is still unusable in a browser — it reads a secret from process.env.
 *
 * Two operational notes that will bite during real testing (RESEARCH.md
 * Pitfalls 3 and 4):
 *  - Meta's free developer test number only sends to numbers explicitly
 *    added to its allowed-recipient list (hard cap 5). A send to any other
 *    number returns a 4xx naming the recipient list.
 *  - The access token MUST be a long-lived System User token. The token the
 *    API Setup quickstart page shows expires in 24 hours: sends work on day
 *    one and start returning 401 the next day with no code change.
 */

/** [VERIFIED: developers.facebook.com, 2026-09-10] */
export const GRAPH_API_VERSION = "v25.0";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}

export async function sendWhatsAppTextMessage(
  toPhoneNumber: string,
  body: string,
): Promise<{ metaMessageId: string }> {
  const phoneNumberId = requiredEnv("META_WHATSAPP_PHONE_NUMBER_ID");
  const accessToken = requiredEnv("META_WHATSAPP_ACCESS_TOKEN");

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toPhoneNumber,
        type: "text",
        text: { body },
      }),
    },
  );

  if (!response.ok) {
    // Meta's error body carries the actual cause (recipient not in the test
    // number's allowed list, expired token, rate limit). Surfacing it is what
    // makes an Inngest retry debuggable instead of a mystery. The access
    // token is never included — only the status and Meta's own message.
    const errorBody = await response.text();
    throw new Error(`WhatsApp send failed (${response.status}): ${errorBody}`);
  }

  const json = (await response.json()) as { messages: [{ id: string }] };
  return { metaMessageId: json.messages[0].id };
}
