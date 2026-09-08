import "server-only";
import { eq, sql } from "drizzle-orm";
import type { OrganizationMembershipJSON } from "@clerk/backend";
import { db } from "@/lib/db";
import { teamMembers } from "@/lib/db/schema/team-members";

/**
 * Called only from the `organizationMembership.created` Clerk webhook
 * (app/api/webhooks/clerk/route.ts). This single event fires for BOTH cases
 * this app needs to handle:
 *
 *   1. An invited member accepts and joins — a `team_members` row already
 *      exists (`status: "invited"`, inserted by `inviteMember`). This
 *      transitions it to `status: "active"`, backfilling `clerk_user_id`
 *      and `joined_at`.
 *   2. The founder/admin who creates the agency's Clerk organization —
 *      Clerk auto-adds the creator as an org member with no invitation
 *      ever having gone through `inviteMember`, so no `team_members` row
 *      exists yet. Without this case, the founder would be authenticated
 *      via Clerk but have no `team_members` row at all, and every
 *      role/assignment-aware query (`withTenantContext`'s own GUC lookup
 *      included) would treat them as having no role — locking the founder
 *      out of their own team-management and client-assignment features.
 *      Detected via `organization.created_by === public_user_data.user_id`
 *      (part of the same webhook payload, not a second API call) — this is
 *      the one case where a `team_members` row is created directly as
 *      `active`/`admin`, bypassing the invite flow, because it's not a
 *      bypass at all: nobody could have invited the founder to their own
 *      not-yet-existing agency.
 *
 * Any OTHER unmatched membership (no existing invited row, and not the org
 * creator) is logged, not silently provisioned — auto-creating a
 * `team_members` row for an arbitrary Clerk membership would be a way to
 * bypass `inviteMember`'s invite-time role/WhatsApp-number capture
 * entirely.
 *
 * Uses the raw, unscoped `db` export with `db.batch([set_config, query])`
 * for every step — same pattern as `lib/agencies/create-agency.ts` and for
 * the same reason: there is no tenant context yet for `withTenantContext`
 * to set (this call is what provisions team membership in the first
 * place), and `app.agency_id` is transaction-local (`set_config(...,
 * true)`), so it must be re-set in every separate `db.batch()` call — it
 * does not survive from one batch to the next.
 */
export async function syncTeamMemberFromClerkMembership(
  membership: OrganizationMembershipJSON,
): Promise<void> {
  const agencyId = membership.organization.id;
  const clerkUserId = membership.public_user_data.user_id;
  const email = membership.public_user_data.identifier.trim().toLowerCase();
  const createdBy = membership.organization.created_by;

  const existingResult = await db.batch([
    db.execute(sql`SELECT set_config('app.agency_id', ${agencyId}, true)`),
    db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(eq(teamMembers.email, email)),
  ]);
  const existing = existingResult[1][0];

  if (existing) {
    await db.batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyId}, true)`),
      db
        .update(teamMembers)
        .set({ clerkUserId, status: "active", joinedAt: sql`now()` })
        .where(eq(teamMembers.id, existing.id)),
    ]);
    return;
  }

  if (createdBy && clerkUserId === createdBy) {
    await db.batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyId}, true)`),
      db
        .insert(teamMembers)
        .values({
          agencyId,
          clerkUserId,
          email,
          role: "admin",
          status: "active",
          joinedAt: sql`now()`,
        })
        .onConflictDoNothing({ target: [teamMembers.agencyId, teamMembers.email] }),
    ]);
    return;
  }

  console.warn(
    `Clerk organizationMembership.created for user ${clerkUserId} in agency ${agencyId} matches no invited team_members row and is not the organization's creator — skipping. No team_members row was created; this membership joined outside the invite flow, so no role/WhatsApp number was captured for it.`,
  );
}
