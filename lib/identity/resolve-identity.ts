import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { authorizedContacts } from "@/lib/db/schema/authorized-contacts";
import { teamMembers } from "@/lib/db/schema/team-members";
import { identityDb } from "@/lib/tenant/with-resolved-identity-context";
import { classifyIdentity } from "./classify-identity";
import type { ResolvedIdentity } from "./types";

/**
 * SEG-01: resolve an incoming sender to exactly one identity BEFORE any
 * response is generated or any client data is loaded.
 *
 * Read-only by design: it sets `app.agency_id` (so the two lookups below can
 * see anything at all — both tables' SELECT policies are agency-gated) and
 * NOTHING else. Setting the identity's own GUCs is
 * `withResolvedIdentityContext`'s job, deliberately kept separate so a
 * resolution never accidentally becomes an authorization.
 *
 * Lookup order, per D-06: `team_members.whatsapp_number` first, then
 * `authorized_contacts.phone_number`. A number cannot legitimately be in both
 * — migration 0006's bidirectional trigger rejects the second insert — and
 * `classifyIdentity` still resolves the collision deterministically if one is
 * ever introduced by a direct database edit.
 *
 * `agencyId` is an explicit parameter, not derived here (D-07 note): mapping a
 * destination WhatsApp number to an agency arrives with Embedded Signup in
 * Phase 3. This function assumes no source for it.
 *
 * Accepted v1 trust assumption (RESEARCH.md Security Domain): `phoneNumber` is
 * whatever Meta's Tech-Provider-attested sender field says. Genzia performs no
 * independent proof of phone ownership in v1; carrier-level SIM reassignment or
 * sender spoofing is out of scope and is not an oversight here.
 */
export async function resolveIdentity(
  agencyId: string,
  phoneNumber: string,
): Promise<ResolvedIdentity> {
  return identityDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.agency_id', ${agencyId}, true)`);

    const [memberRow] = await tx
      .select({ id: teamMembers.id, role: teamMembers.role })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.agencyId, agencyId),
          eq(teamMembers.whatsappNumber, phoneNumber),
        ),
      );

    if (memberRow) {
      return classifyIdentity(memberRow, null);
    }

    const [contactRow] = await tx
      .select({
        id: authorizedContacts.id,
        clientId: authorizedContacts.clientId,
        optInConfirmedByTeam: authorizedContacts.optInConfirmedByTeam,
      })
      .from(authorizedContacts)
      .where(
        and(
          eq(authorizedContacts.agencyId, agencyId),
          eq(authorizedContacts.phoneNumber, phoneNumber),
        ),
      );

    return classifyIdentity(null, contactRow ?? null);
  });
}
