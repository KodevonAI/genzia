import { inngest } from "@/inngest/client";
import type { ResolvedIdentity } from "@/lib/identity/types";
import {
  MetaWebhookVerificationError,
  verifyMetaWebhookSignature,
} from "@/lib/webhooks/verify-meta-signature";
import { ingestInboundMessage } from "@/lib/whatsapp/ingest-inbound-message";
import { parseMetaWebhookPayload } from "@/lib/whatsapp/parse-webhook-payload";
import { recordDeliveryStatus } from "@/lib/whatsapp/record-delivery-status";

// Signature verification needs Node's crypto module, not the Edge runtime —
// same constraint as app/api/webhooks/clerk/route.ts.
export const runtime = "nodejs";
// The GET handshake must never be prerendered or cached: Meta sends a fresh
// hub.challenge each time and expects that exact value echoed back.
export const dynamic = "force-dynamic";

/**
 * Meta's one-time verification handshake. Registered once, when the callback
 * URL is saved in the App Dashboard.
 *
 * The response body MUST be the bare `hub.challenge` string. Returning
 * `Response.json(...)` or any wrapper is the single most common integration
 * failure for this endpoint — Meta rejects the webhook registration outright
 * and the dashboard's "Verify and Save" fails immediately.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    // Plain text, NOT Response.json().
    return new Response(challenge ?? "", { status: 200 });
  }
  console.warn("Meta webhook: verification handshake rejected.");
  return new Response("Forbidden", { status: 403 });
}

/** team_members.id / authorized_contacts.id, or null for an unknown sender. */
function identityRowId(identity: ResolvedIdentity): string | null {
  if (identity.type === "team_member") return identity.teamMemberId;
  if (identity.type === "client_contact") return identity.contactId;
  return null;
}

function identityClientId(identity: ResolvedIdentity): string | null {
  return identity.type === "client_contact" ? identity.clientId : null;
}

export async function POST(request: Request): Promise<Response> {
  // The raw body is required for signature verification — reading it any
  // other way (e.g. `request.json()` first) would break verification, since
  // the HMAC is computed over these exact bytes.
  const rawBody = await request.text();

  try {
    verifyMetaWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"));
  } catch (error) {
    if (error instanceof MetaWebhookVerificationError) {
      console.warn("Meta webhook: signature verification failed", error.message);
    } else {
      console.warn("Meta webhook: signature verification failed", error);
    }
    // Reject before any database access — a forged request never reaches
    // ingestInboundMessage or recordDeliveryStatus.
    return new Response("Invalid signature", { status: 400 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // A signed body that is not JSON is not something a retry will fix.
    console.warn("Meta webhook: verified body was not valid JSON.");
    return new Response("ok", { status: 200 });
  }

  const changes = parseMetaWebhookPayload(payload);

  let processed = 0;
  let failed = 0;

  for (const change of changes) {
    for (const message of change.messages) {
      try {
        const result = await ingestInboundMessage(
          message,
          change.phoneNumberId,
          change.displayPhoneNumber,
        );
        // The ack is dispatched ONLY for a newly-inserted row. Meta redelivers
        // the same payload on any non-200 (and on its own timeouts) for up to
        // 7 days, so gating on `ingested` is what stops one message from
        // producing two acks on a real person's phone.
        if (result.outcome === "ingested") {
          // Awaited on purpose: this is a fast HTTP POST to Inngest's event
          // ingest endpoint, and an unawaited call risks the serverless
          // invocation being frozen before it completes. The slow work runs
          // in a separate Inngest-invoked function, not here.
          await inngest.send({
            name: "whatsapp/message.received",
            data: {
              messageRowId: result.messageRowId,
              agencyId: result.agencyId,
              senderPhoneNumber: message.from,
              platformPhoneNumber: change.displayPhoneNumber,
              resolvedIdentityType: result.identity.type,
              resolvedIdentityId: identityRowId(result.identity),
              clientId: identityClientId(result.identity),
            },
          });
        }
        processed += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `Meta webhook: failed to process message ${message.metaMessageId}`,
          error,
        );
      }
    }

    for (const status of change.statuses) {
      try {
        await recordDeliveryStatus(status, change.phoneNumberId);
        processed += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `Meta webhook: failed to record status for ${status.metaMessageId}`,
          error,
        );
      }
    }
  }

  // Retry policy. Meta redelivers on any non-200, and every write path in
  // this handler is idempotent, so a retry is safe. But retrying is only
  // USEFUL for a transient failure: if some items succeeded, a redelivery
  // would re-walk the successful ones for no gain, so the batch is
  // acknowledged. If every item failed, the cause is more likely transient
  // (database unreachable) than deterministic, so Meta is asked to retry.
  if (failed > 0 && processed === 0) {
    return new Response("Processing failed", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
