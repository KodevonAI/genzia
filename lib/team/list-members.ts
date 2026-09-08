import "server-only";
import { eq } from "drizzle-orm";
import { teamMembers } from "@/lib/db/schema/team-members";
import { withTenantContext } from "@/lib/tenant/with-tenant-context";

export type TeamMemberRow = typeof teamMembers.$inferSelect;

/**
 * Returns every `team_members` row for the caller's agency. NOT admin-only
 * to call — the roster itself is visible to any team member (RLS's
 * `team_members_tenant_isolation` scopes by `agency_id` only, no role
 * check); only *mutating* the roster (inviting, assigning clients) is
 * admin-only, enforced separately in `lib/team/invite-member.ts` and
 * `lib/clients/assign-client.ts`.
 */
export async function listTeamMembers(): Promise<TeamMemberRow[]> {
  return withTenantContext((tx) => tx.select().from(teamMembers).orderBy(teamMembers.invitedAt));
}

/**
 * Single `team_members` row by id, scoped to the caller's agency the same
 * way `listTeamMembers` is. Used by the per-member client-assignment page
 * (admin-only at the page level, not here) to load the member being
 * configured.
 */
export async function getTeamMemberById(id: string): Promise<TeamMemberRow | null> {
  return withTenantContext(async (tx) => {
    const [row] = await tx.select().from(teamMembers).where(eq(teamMembers.id, id));
    return row ?? null;
  });
}
