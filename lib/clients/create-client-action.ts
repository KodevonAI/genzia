"use server";

import { auth } from "@clerk/nextjs/server";
import { NoTenantContextError, withTenantContext } from "@/lib/tenant/with-tenant-context";
import { findCallerTeamMember } from "@/lib/team/current-member";
import {
  type CreateClientInput,
  type CreateClientResult,
  insertClientRow,
  validateCreateClientInput,
} from "@/lib/clients/create-client";

/**
 * The web Server Action twin of `createClient` (`create-client.ts`). Takes
 * NO `agencyId`/`identity` parameter — both are derived only from the real
 * Clerk session, mirroring `updateBrandConfig`'s established pattern
 * (T-05-08). Any team member (admin or non-admin) is allowed here; the
 * `clients_insert_by_team_member` RLS policy (plan 05-01) is the real
 * boundary, this function does not re-check role.
 */
export async function createClientAction(input: CreateClientInput): Promise<CreateClientResult> {
  const validated = validateCreateClientInput(input);
  if (!validated.ok) {
    return { success: false, error: validated.error };
  }

  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return { success: false, error: "unknown" };
  }

  try {
    return await withTenantContext(async (tx) => {
      const member = await findCallerTeamMember(tx, userId);
      if (!member) {
        return { success: false, error: "forbidden" };
      }
      return insertClientRow(tx, orgId, member.id, validated.value);
    });
  } catch (err) {
    if (err instanceof NoTenantContextError) {
      return { success: false, error: "unknown" };
    }
    throw err;
  }
}
