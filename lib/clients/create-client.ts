import { ilike } from "drizzle-orm";
import { clients } from "@/lib/db/schema/clients";
import { isClientIndustry } from "@/lib/clients/industries";
import { insertAssignment } from "@/lib/clients/insert-assignment";
import type { ResolvedIdentity } from "@/lib/identity/types";
import {
  type IdentityTx,
  withResolvedIdentityContext,
} from "@/lib/tenant/with-resolved-identity-context";

/**
 * Agent-facing core (no `"use server"` directive, no throwing-under-tsx
 * import guard, no tenant-context-shaped import beyond
 * `withResolvedIdentityContext` itself) — safe to load under plain `tsx`
 * and inside Inngest. The web-facing twin, `create-client-action.ts`,
 * imports `validateCreateClientInput` and `insertClientRow` from this file
 * but never the other way around. See 05-03-PLAN.md's `<interfaces>`
 * section for exactly why this split exists.
 */

export type CreateClientInput = {
  name: string;
  phone?: string;
  email?: string;
  industry?: string;
  notes?: string;
};

export type CreateClientError =
  | "nameRequired"
  | "contactRequired"
  | "invalidIndustry"
  | "forbidden"
  | "unknown";

export type CreateClientResult =
  | { success: true; clientId: string; duplicateWarning: string | null }
  | { success: false; error: CreateClientError };

type ValidatedCreateClientValue = {
  name: string;
  phone: string | null;
  email: string | null;
  industry: string | null;
  notes: string | null;
};

type ValidateCreateClientOutcome =
  | { ok: true; value: ValidatedCreateClientValue }
  | { ok: false; error: CreateClientError };

/**
 * D-02: name is required, and at least one of phone/email is required.
 * Blank/absent phone or email is normalized to `null` (never an empty
 * string), matching the DB's own `clients_contact_required_check`.
 */
export function validateCreateClientInput(
  input: CreateClientInput,
): ValidateCreateClientOutcome {
  const name = input.name.trim();
  if (!name) {
    return { ok: false, error: "nameRequired" };
  }

  const phone = input.phone?.trim() || null;
  const email = input.email?.trim() || null;
  if (!phone && !email) {
    return { ok: false, error: "contactRequired" };
  }

  let industry: string | null = null;
  if (input.industry !== undefined && input.industry !== null && input.industry !== "") {
    if (!isClientIndustry(input.industry)) {
      return { ok: false, error: "invalidIndustry" };
    }
    industry = input.industry;
  }

  const notes = input.notes ?? null;

  return { ok: true, value: { name, phone, email, industry, notes } };
}

/**
 * Runs inside an already-open transaction (either `IdentityTx` from
 * `createClient` below, or `TenantTx` from `createClientAction`). Looks up
 * one existing RLS-visible row matching `value.name` case-insensitively
 * (exact match, not a substring "contains" search — D-09), inserts the new
 * row, self-assigns the creator, and returns a non-null `duplicateWarning`
 * string when a match was found. The duplicate is a returned warning, never
 * a thrown error: the model relays it and asks the human back, the web form
 * ignores this field entirely (per UI-SPEC, duplicate-name confirm is
 * agent-dictation only).
 */
export async function insertClientRow(
  tx: IdentityTx,
  agencyId: string,
  creatorTeamMemberId: string,
  value: ValidatedCreateClientValue,
): Promise<CreateClientResult> {
  const [match] = await tx
    .select({ name: clients.name })
    .from(clients)
    .where(ilike(clients.name, value.name))
    .limit(1);

  const [inserted] = await tx
    .insert(clients)
    .values({
      agencyId,
      name: value.name,
      phone: value.phone,
      email: value.email,
      industry: value.industry,
      notes: value.notes,
    })
    .returning({ id: clients.id });

  await insertAssignment(tx, agencyId, inserted.id, creatorTeamMemberId);

  return {
    success: true,
    clientId: inserted.id,
    duplicateWarning: match
      ? `Ya existe un cliente llamado ${match.name}. ¿Es el mismo o uno nuevo?`
      : null,
  };
}

/**
 * The agent-tool entry point. `agencyId`/`identity` are explicit trusted
 * server-side arguments supplied by the caller (`runTurn`/
 * `classifyAndExecute`), never re-derived from a session and never taken
 * from the model's own tool-call arguments (mirrors `deliverToClient`'s own
 * params shape).
 */
export async function createClient(params: {
  agencyId: string;
  identity: ResolvedIdentity;
  input: CreateClientInput;
}): Promise<CreateClientResult> {
  const { agencyId, identity, input } = params;

  const validated = validateCreateClientInput(input);
  if (!validated.ok) {
    return { success: false, error: validated.error };
  }

  // Defense in depth — toolsFor() already prevents a non-team_member
  // identity from reaching this function in practice.
  if (identity.type !== "team_member") {
    return { success: false, error: "forbidden" };
  }

  return withResolvedIdentityContext(agencyId, identity, (tx) =>
    insertClientRow(tx, agencyId, identity.teamMemberId, validated.value),
  );
}
