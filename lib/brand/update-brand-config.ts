"use server";

import { sql } from "drizzle-orm";
import { withTenantContext } from "@/lib/tenant/with-tenant-context";
import { agentBrandConfig } from "@/lib/db/schema/agent-brand-config";
import { isBrandTone } from "./tone";

export type UpdateBrandConfigInput = {
  agentName: string;
  tone: string;
  logoUrl: string | null;
};

export type UpdateBrandConfigError =
  | "agentNameRequired"
  | "agentNameTooLong"
  | "invalidTone"
  | "forbidden"
  | "unknown";

export type UpdateBrandConfigResult =
  | { success: true }
  | { success: false; error: UpdateBrandConfigError };

/**
 * Server Action (file-level "use server" — every other export here is a
 * type, erased at compile time, so this still satisfies Next's "an actions
 * file may only export async functions" rule). Wrapped in withTenantContext
 * like every tenant-scoped write; role is re-checked here explicitly
 * because `agent_brand_config`'s RLS policy is agency-wide, not role-gated
 * (see 0001_rls_policies.sql) — Postgres alone does not stop a non-admin
 * member from writing this table.
 */
export async function updateBrandConfig(
  input: UpdateBrandConfigInput,
): Promise<UpdateBrandConfigResult> {
  const agentName = input.agentName.trim();
  if (agentName.length === 0) {
    return { success: false, error: "agentNameRequired" };
  }
  if (agentName.length > 60) {
    return { success: false, error: "agentNameTooLong" };
  }
  if (!isBrandTone(input.tone)) {
    return { success: false, error: "invalidTone" };
  }
  const tone = input.tone;

  try {
    const forbidden = await withTenantContext(async (tx) => {
      const { rows } = await tx.execute<{
        agency_id: string | null;
        role: string | null;
      }>(
        sql`SELECT current_setting('app.agency_id', true) AS agency_id, current_setting('app.role', true) AS role`,
      );
      const agencyId = rows[0]?.agency_id;
      const role = rows[0]?.role;

      if (!agencyId || role !== "admin") {
        return true;
      }

      await tx
        .insert(agentBrandConfig)
        .values({
          agencyId,
          agentName,
          tone,
          logoUrl: input.logoUrl,
        })
        .onConflictDoUpdate({
          target: agentBrandConfig.agencyId,
          set: {
            agentName,
            tone,
            logoUrl: input.logoUrl,
            updatedAt: new Date(),
          },
        });
      return false;
    });

    if (forbidden) {
      return { success: false, error: "forbidden" };
    }
  } catch (err) {
    console.error("Failed to update brand config:", err);
    return { success: false, error: "unknown" };
  }

  return { success: true };
}
