"use server";

import "server-only";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { authorizedContacts } from "@/lib/db/schema/authorized-contacts";
import { clients } from "@/lib/db/schema/clients";
import { NoTenantContextError, withTenantContext } from "@/lib/tenant/with-tenant-context";
import { NotAdminError, assertCallerIsAdmin } from "@/lib/team/current-member";

// Intentionally identical to lib/team/invite-member.ts's WHATSAPP_RE — one
// phone-shape rule for the whole app. Full E.164 validation stays deferred
// to Phase 3's Meta integration (the same call already made twice); do not
// add a third-party phone-parsing dependency here.
const WHATSAPP_RE = /^\+[1-9]\d{7,14}$/;

async function requireOrgContext() {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    throw new NoTenantContextError();
  }
  return { userId, orgId };
}

export type AddAuthorizedContactInput = {
  clientId: string;
  name: string;
  phoneNumber: string;
  email?: string | null;
  contactRole?: string | null;
  /**
   * D-03: the team's explicit, mandatory attestation that this contact gave
   * affirmative WhatsApp consent. No default — the caller must pass `true`
   * literally, and the UI checkbox that eventually feeds this must render
   * unchecked. This is the agency's own claim, NOT a Meta-verified opt-in.
   */
  optInConfirmed: boolean;
};

export type AddAuthorizedContactResult =
  | { ok: true; contactId: string }
  | { ok: false; error: "not_admin" | "invalid_name" | "invalid_phone" | "opt_in_required" }
  | { ok: false; error: "phone_already_linked"; existingClientName: string | null };

/**
 * Admin-only (D-10 / SEG-03), opt-in-enforcing (D-03 / SEG-04) insert into
 * the contact roster. Validation happens BEFORE any transaction is opened
 * (same shape as lib/team/invite-member.ts) so every expected failure comes
 * back as a typed `{ ok: false, error }` result rather than a thrown error.
 *
 * `agencyId`, `optInConfirmedBy`, and `optInConfirmedAt` are always derived
 * server-side — never accepted from the caller — so a forged attestation or
 * cross-tenant write is structurally impossible (T-02-12).
 */
export async function addAuthorizedContact(
  input: AddAuthorizedContactInput,
): Promise<AddAuthorizedContactResult> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return { ok: false, error: "invalid_name" };
  }
  if (!WHATSAPP_RE.test(input.phoneNumber)) {
    return { ok: false, error: "invalid_phone" };
  }
  // Strict `!== true` (not falsiness) so a stray truthy value can never
  // stand in for the mandatory, unchecked-by-default checkbox.
  if (input.optInConfirmed !== true) {
    return { ok: false, error: "opt_in_required" };
  }

  const { userId, orgId } = await requireOrgContext();

  try {
    return await withTenantContext(async (tx) => {
      // RLS (authorized_contacts_write_admin_only) already blocks this
      // write for a non-admin — this explicit check keeps the failure
      // typed and fails closed by construction (same reasoning as
      // assign-client.ts's assertCallerIsAdmin call).
      const admin = await assertCallerIsAdmin(tx, userId);

      const [row] = await tx
        .insert(authorizedContacts)
        .values({
          agencyId: orgId,
          clientId: input.clientId,
          name: trimmedName,
          phoneNumber: input.phoneNumber,
          email: input.email ?? null,
          contactRole: input.contactRole ?? null,
          optInConfirmedByTeam: true,
          optInConfirmedBy: admin.id,
          optInConfirmedAt: new Date(),
        })
        .returning({ id: authorizedContacts.id });

      return { ok: true, contactId: row.id } as const;
    });
  } catch (err) {
    if (err instanceof NotAdminError) {
      return { ok: false, error: "not_admin" };
    }

    // D-08: the real enforcement is the unique index
    // (authorized_contacts_agency_id_phone_number_idx) and migration
    // 0006's cross-table trigger — a pre-check here would race. Catch the
    // resulting error and, best-effort, look up the client that already
    // owns the number so the message can name it. The block itself already
    // happened at the database layer regardless of whether this lookup
    // succeeds.
    const message = err instanceof Error ? err.message : String(err);
    const isDuplicate =
      message.includes("authorized_contacts_agency_id_phone_number_idx") ||
      message.includes("is already linked to client") ||
      message.includes("is already registered as a team member WhatsApp number");

    if (isDuplicate) {
      const [existing] = await withTenantContext((tx) =>
        tx
          .select({ name: clients.name })
          .from(authorizedContacts)
          .innerJoin(clients, eq(clients.id, authorizedContacts.clientId))
          .where(
            and(
              eq(authorizedContacts.agencyId, orgId),
              eq(authorizedContacts.phoneNumber, input.phoneNumber),
            ),
          ),
      );
      return {
        ok: false,
        error: "phone_already_linked",
        existingClientName: existing?.name ?? null,
      };
    }

    throw err;
  }
}
