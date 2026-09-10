import { findAgencyByTeamWhatsAppNumber } from "./find-agency-by-whatsapp-number";

/**
 * Which agency does an inbound WhatsApp message belong to?
 *
 * Two number classes (see 03-05-PLAN.md architecture_decision):
 *  - An AGENCY-OWNED number: the destination number itself identifies the
 *    agency. Sourced from META_AGENCY_PHONE_NUMBER_MAP, the deliberate
 *    platform-side stand-in for what WA-02's Embedded Signup will persist in
 *    the database once Meta approves Genzia's business verification (D-03
 *    defers the Embedded Signup UI, not this routing seam).
 *  - The SHARED INTERNAL number (WA-03, META_WHATSAPP_PHONE_NUMBER_ID): every
 *    agency's team members write to the same number, so the agency comes from
 *    the SENDER's registration (WA-04), never from the destination number.
 *
 * `no_agency` means there is genuinely no tenant to attribute the message to.
 * Callers must write nothing and send nothing — `messages.agency_id` is NOT
 * NULL with an FK to `agencies`, and inventing an agency for a stranger would
 * be cross-tenant data injection.
 */
export type InboundAgencyResolution =
  | { kind: "agency_number"; agencyId: string }
  | { kind: "shared_internal"; agencyId: string }
  | {
      kind: "no_agency";
      reason: "unknown_sender_on_shared_number" | "unmapped_phone_number_id";
    };

/**
 * Parsed once per process. A malformed value degrades to an empty map with a
 * warning rather than throwing: a bad env var must not turn every inbound
 * webhook into a 500 and a 7-day Meta retry loop.
 */
let cachedMap: Record<string, string> | null = null;

function agencyNumberMap(): Record<string, string> {
  if (cachedMap) return cachedMap;
  const raw = process.env.META_AGENCY_PHONE_NUMBER_MAP;
  if (!raw || raw.trim() === "") {
    cachedMap = {};
    return cachedMap;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("expected a JSON object");
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value !== "") result[key] = value;
    }
    cachedMap = result;
  } catch (err) {
    console.warn(
      "META_AGENCY_PHONE_NUMBER_MAP is not valid JSON of shape {\"<phone_number_id>\":\"<agency_id>\"} — treating it as empty. See .env.example.",
      err instanceof Error ? err.message : err,
    );
    cachedMap = {};
  }
  return cachedMap;
}

/** Test seam: lets scripts/verify-whatsapp-webhook.ts set the map at runtime. */
export function resetAgencyNumberMapCache(): void {
  cachedMap = null;
}

export async function resolveInboundAgency(
  phoneNumberId: string,
  fromPhoneNumber: string,
): Promise<InboundAgencyResolution> {
  const mapped = agencyNumberMap()[phoneNumberId];
  if (mapped) {
    return { kind: "agency_number", agencyId: mapped };
  }

  if (phoneNumberId === process.env.META_WHATSAPP_PHONE_NUMBER_ID) {
    const agencyId = await findAgencyByTeamWhatsAppNumber(fromPhoneNumber);
    if (agencyId) {
      return { kind: "shared_internal", agencyId };
    }
    return { kind: "no_agency", reason: "unknown_sender_on_shared_number" };
  }

  return { kind: "no_agency", reason: "unmapped_phone_number_id" };
}
