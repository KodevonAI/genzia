import "server-only";
import { withTenantContext } from "@/lib/tenant/with-tenant-context";
import { agentBrandConfig } from "@/lib/db/schema/agent-brand-config";
import { type BrandConfig, isBrandTone } from "./tone";

export { BRAND_TONES, type BrandTone, type BrandConfig, isBrandTone } from "./tone";

const DEFAULT_BRAND_CONFIG: BrandConfig = {
  agentName: "",
  tone: "professional",
  logoUrl: null,
};

/**
 * Upsert-on-read: if no `agent_brand_config` row exists yet for the
 * caller's agency, returns sensible defaults WITHOUT creating a row — only
 * `updateBrandConfig` (./update-brand-config.ts) actually writes one, via
 * `INSERT ... ON CONFLICT (agency_id) DO UPDATE`.
 */
export async function getBrandConfig(): Promise<BrandConfig> {
  const row = await withTenantContext(async (tx) => {
    const [existing] = await tx.select().from(agentBrandConfig).limit(1);
    return existing ?? null;
  });

  if (!row) return DEFAULT_BRAND_CONFIG;

  return {
    agentName: row.agentName ?? DEFAULT_BRAND_CONFIG.agentName,
    tone: isBrandTone(row.tone) ? row.tone : DEFAULT_BRAND_CONFIG.tone,
    logoUrl: row.logoUrl,
  };
}
