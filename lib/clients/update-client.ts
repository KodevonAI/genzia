import { eq } from "drizzle-orm";
import { clients } from "@/lib/db/schema/clients";
import { isClientIndustry } from "@/lib/clients/industries";
import type { ResolvedIdentity } from "@/lib/identity/types";
import {
  type IdentityTx,
  withResolvedIdentityContext,
} from "@/lib/tenant/with-resolved-identity-context";

/**
 * Agent-facing core (no `"use server"` directive, no throwing-under-tsx
 * import guard) — same tsx-safe posture as `create-client.ts`. The
 * web-facing twin, `update-client-action.ts`, imports `writeClientUpdate`
 * from this file but never the other way around.
 */

export type UpdateClientInput = Partial<{
  name: string;
  phone: string;
  email: string;
  industry: string;
  notes: string;
}>;

export type UpdateClientError =
  | "nameRequired"
  | "contactRequired"
  | "invalidIndustry"
  | "notFound"
  | "forbidden"
  | "unknown";

export type UpdateClientResult = { success: true } | { success: false; error: UpdateClientError };

/**
 * Reads the current row (RLS-scoped), merges the caller's explicitly
 * supplied fields onto it (an omitted field keeps its old value; an
 * explicit empty string/`null` on phone/email/notes clears it), re-
 * validates the MERGED result with the same rules `createClient` uses, and
 * writes. 0 rows on either the SELECT or the UPDATE collapses to the same
 * `notFound` error — never distinguished from "does not exist", to avoid an
 * enumeration oracle (T-05-10).
 */
export async function writeClientUpdate(
  tx: IdentityTx,
  clientId: string,
  patch: UpdateClientInput,
): Promise<UpdateClientResult> {
  const [current] = await tx
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (!current) {
    return { success: false, error: "notFound" };
  }

  const mergedName = ("name" in patch ? patch.name : current.name)?.trim() ?? "";
  if (!mergedName) {
    return { success: false, error: "nameRequired" };
  }

  const mergedPhone = "phone" in patch ? patch.phone?.trim() || null : current.phone;
  const mergedEmail = "email" in patch ? patch.email?.trim() || null : current.email;
  if (!mergedPhone && !mergedEmail) {
    return { success: false, error: "contactRequired" };
  }

  let mergedIndustry: string | null;
  if ("industry" in patch) {
    const patchIndustry = patch.industry?.trim() || null;
    if (patchIndustry !== null && !isClientIndustry(patchIndustry)) {
      return { success: false, error: "invalidIndustry" };
    }
    mergedIndustry = patchIndustry;
  } else {
    mergedIndustry = current.industry;
  }

  const mergedNotes = "notes" in patch ? patch.notes?.trim() || null : current.notes;

  const [updated] = await tx
    .update(clients)
    .set({
      name: mergedName,
      phone: mergedPhone,
      email: mergedEmail,
      industry: mergedIndustry,
      notes: mergedNotes,
    })
    .where(eq(clients.id, clientId))
    .returning({ id: clients.id });

  if (!updated) {
    return { success: false, error: "notFound" };
  }

  return { success: true };
}

/**
 * The agent-tool entry point — same explicit trusted-arguments shape as
 * `createClient`.
 */
export async function updateClient(params: {
  agencyId: string;
  identity: ResolvedIdentity;
  clientId: string;
  input: UpdateClientInput;
}): Promise<UpdateClientResult> {
  const { agencyId, identity, clientId, input } = params;

  if (identity.type !== "team_member") {
    return { success: false, error: "forbidden" };
  }

  return withResolvedIdentityContext(agencyId, identity, (tx) =>
    writeClientUpdate(tx, clientId, input),
  );
}
