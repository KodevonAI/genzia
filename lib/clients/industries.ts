/**
 * Single source of truth for the 8 client-industry codes (Phase 5 CRM).
 * Bilingual-code-not-label, matching `lib/brand/tone.ts`'s `isBrandTone`
 * guard-function shape. Labels live only in `messages/{es,en}.json` under
 * `Clients.industries.<code>` — deliberately not added here.
 */
export const CLIENT_INDUSTRY_CODES = [
  "restaurants_food",
  "health_beauty",
  "fashion_retail",
  "professional_services",
  "real_estate",
  "fitness_sports",
  "education",
  "other",
] as const;

export type ClientIndustry = (typeof CLIENT_INDUSTRY_CODES)[number];

export function isClientIndustry(
  value: string | null | undefined,
): value is ClientIndustry {
  return (
    !!value && (CLIENT_INDUSTRY_CODES as readonly string[]).includes(value)
  );
}
