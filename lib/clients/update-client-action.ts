"use server";

import { auth } from "@clerk/nextjs/server";
import { NoTenantContextError, withTenantContext } from "@/lib/tenant/with-tenant-context";
import {
  type UpdateClientInput,
  type UpdateClientResult,
  writeClientUpdate,
} from "@/lib/clients/update-client";

/**
 * The web Server Action twin of `updateClient` (`update-client.ts`). Mirrors
 * `create-client-action.ts`: derives `orgId` only from the real Clerk
 * session, opens `withTenantContext`, and calls `writeClientUpdate`
 * directly. No `findCallerTeamMember` lookup needed here — the update RLS
 * policy from plan 05-01 already enforces admin-or-assigned; a signed-in
 * caller with no `team_members` row at all still resolves to 0 GUCs beyond
 * `app.agency_id`, which means 0 rows updated, which is `notFound` — the
 * correct fail-closed outcome (do not special-case it).
 */
export async function updateClientAction(
  clientId: string,
  input: UpdateClientInput,
): Promise<UpdateClientResult> {
  const { userId } = await auth();
  if (!userId) {
    return { success: false, error: "unknown" };
  }

  try {
    return await withTenantContext((tx) => writeClientUpdate(tx, clientId, input));
  } catch (err) {
    if (err instanceof NoTenantContextError) {
      return { success: false, error: "unknown" };
    }
    throw err;
  }
}
