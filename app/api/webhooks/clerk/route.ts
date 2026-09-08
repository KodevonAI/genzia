import {
  ClerkWebhookVerificationError,
  verifyClerkWebhookSignature,
} from "@/lib/webhooks/verify-clerk-signature";
import {
  createAgencyFromClerkOrg,
  markAgencyInactiveFromClerkOrg,
} from "@/lib/agencies/create-agency";
import { syncTeamMemberFromClerkMembership } from "@/lib/team/sync-membership";

// `svix` needs Node's crypto module, not the Edge runtime.
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  // The raw body is required for signature verification — reading it any
  // other way (e.g. `request.json()` first) would break verification, since
  // the signature is computed over these exact bytes.
  const rawBody = await request.text();

  let event;
  try {
    event = verifyClerkWebhookSignature(rawBody, {
      "svix-id": request.headers.get("svix-id"),
      "svix-timestamp": request.headers.get("svix-timestamp"),
      "svix-signature": request.headers.get("svix-signature"),
    });
  } catch (error) {
    if (error instanceof ClerkWebhookVerificationError) {
      console.warn("Clerk webhook: signature verification failed", error.message);
    } else {
      console.warn("Clerk webhook: signature verification failed", error);
    }
    // Reject before any database write — a forged request never reaches
    // createAgencyFromClerkOrg / markAgencyInactiveFromClerkOrg.
    return new Response("Invalid signature", { status: 400 });
  }

  switch (event.type) {
    case "organization.created": {
      await createAgencyFromClerkOrg(event.data);
      break;
    }
    case "organization.deleted": {
      await markAgencyInactiveFromClerkOrg(event.data);
      break;
    }
    case "organizationMembership.created": {
      // Fires for BOTH an invited member accepting AND the founder who
      // creates the org (Clerk auto-adds them as a member) — see
      // syncTeamMemberFromClerkMembership's doc comment for how it tells
      // the two apart. organizationInvitation.accepted is deliberately not
      // also handled: it fires alongside this event for the invited-member
      // case, and handling both would mean either double-processing (with
      // extra idempotency logic to match) or arbitrarily picking one —
      // organizationMembership.created alone already covers every case this
      // app needs, including the one organizationInvitation.accepted never
      // fires for (the founder).
      await syncTeamMemberFromClerkMembership(event.data);
      break;
    }
    default: {
      // Unhandled event type — not an error. Clerk expects a 2xx response
      // or it keeps retrying delivery.
      break;
    }
  }

  return new Response("ok", { status: 200 });
}
