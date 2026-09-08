/**
 * Shared types/constants for CTA-02 brand config — deliberately free of any
 * "server-only" import or DB/tenant dependency so both the server (
 * get-brand-config.ts, update-brand-config.ts) and the client brand form
 * (app/[locale]/dashboard/settings/brand/brand-form.tsx) can import it
 * directly. Fixed set (a select, not free text) so Phase 4's prompt-building
 * can rely on a known, finite list of tone values.
 */
export const BRAND_TONES = ["professional", "friendly", "playful", "formal"] as const;
export type BrandTone = (typeof BRAND_TONES)[number];

export type BrandConfig = {
  agentName: string;
  tone: BrandTone;
  logoUrl: string | null;
};

export function isBrandTone(value: string | null | undefined): value is BrandTone {
  return !!value && (BRAND_TONES as readonly string[]).includes(value);
}
