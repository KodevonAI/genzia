import { and, eq } from "drizzle-orm";
import { messages } from "@/lib/db/schema/messages";
import { withSystemWebhookContext } from "@/lib/tenant/with-system-webhook-context";
import type { ParsedStatusUpdate } from "./parse-webhook-payload";
import { resolveInboundAgency } from "./resolve-inbound-agency";

/**
 * WA-07: "el costo de conversación se traslada a la agencia de forma
 * transparente." Meta reports the billing facts on the delivery receipt, not
 * on the send response — `statuses[].pricing.category`,
 * `statuses[].pricing.billable` and `statuses[].conversation.id` arrive on the
 * same webhook subscription as inbound messages. This backfills them onto the
 * outbound row so cost per agency is derivable from the message log itself,
 * with no second source of truth to reconcile.
 *
 * This phase's fixed ack is a free-form reply inside the 24h customer service
 * window, i.e. a Service-category message, which is currently free — so the
 * expected value here during Phase 3 testing is `billable: false`. The point
 * is that the plumbing is proven and populated before Phase 4's template-based
 * proactive sends (COB-03, CAL-03), which ARE billed, start flowing through it.
 *
 * Routing note: a status receipt's `recipient_id` is the phone number WE sent
 * to, so the same `resolveInboundAgency` logic applies unchanged — an
 * agency-owned number resolves by destination, the shared internal number
 * resolves by the recipient's own team registration (WA-04).
 *
 * A status for an unknown wamid is normal, not an error: Meta also reports on
 * messages this system never recorded (e.g. sent before this table existed).
 */
export type RecordDeliveryStatusResult = "updated" | "no_match" | "no_agency";

export async function recordDeliveryStatus(
  status: ParsedStatusUpdate,
  phoneNumberId: string,
): Promise<RecordDeliveryStatusResult> {
  const routed = await resolveInboundAgency(
    phoneNumberId,
    status.recipientPhoneNumber,
  );
  if (routed.kind === "no_agency") {
    return "no_agency";
  }

  const agencyId = routed.agencyId;

  return withSystemWebhookContext(agencyId, async (tx) => {
    // Only overwrite pricing/conversation when Meta actually sent them —
    // `sent` receipts often carry no pricing block, and blindly writing null
    // would erase what a later `delivered` receipt already recorded.
    const patch: {
      deliveryStatus: string;
      conversationId?: string;
      pricingCategory?: string;
      pricingBillable?: boolean;
    } = { deliveryStatus: status.status };
    if (status.conversationId !== null) patch.conversationId = status.conversationId;
    if (status.pricingCategory !== null) patch.pricingCategory = status.pricingCategory;
    if (status.pricingBillable !== null) patch.pricingBillable = status.pricingBillable;

    const updated = await tx
      .update(messages)
      .set(patch)
      .where(
        and(
          eq(messages.agencyId, agencyId),
          eq(messages.metaMessageId, status.metaMessageId),
        ),
      )
      .returning({ id: messages.id });

    return updated.length > 0 ? "updated" : "no_match";
  });
}
