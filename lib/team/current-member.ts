import "server-only";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { teamMembers } from "@/lib/db/schema/team-members";
import { withTenantContext } from "@/lib/tenant/with-tenant-context";

/**
 * The transaction type `withTenantContext`'s callback receives — factored
 * out here so helpers that run INSIDE an already-open transaction (rather
 * than opening their own) can be typed without re-deriving this from
 * `withTenantContext` at every call site.
 */
export type TenantTx = Parameters<Parameters<typeof withTenantContext>[0]>[0];

export class NotAdminError extends Error {
  constructor() {
    super("This action is admin-only.");
    this.name = "NotAdminError";
  }
}

export type CurrentTeamMember = {
  id: string;
  role: "admin" | "member";
  status: string;
};

/**
 * Looks up the caller's own `team_members` row by `clerk_user_id`, from
 * inside an ALREADY OPEN `withTenantContext` transaction. Only filters by
 * `clerk_user_id` — RLS (`team_members_tenant_isolation`) has already scoped
 * every row this query could possibly see to the caller's own agency, so
 * re-checking `agency_id` here would be the exact "duplicate the check in
 * application code" anti-pattern STACK-WEB.md §2 warns against.
 */
export async function findCallerTeamMember(
  tx: TenantTx,
  clerkUserId: string,
): Promise<CurrentTeamMember | null> {
  const [row] = await tx
    .select({ id: teamMembers.id, role: teamMembers.role, status: teamMembers.status })
    .from(teamMembers)
    .where(eq(teamMembers.clerkUserId, clerkUserId));

  return row ? { id: row.id, role: row.role as "admin" | "member", status: row.status } : null;
}

/**
 * Re-checks the caller's role from inside an open `withTenantContext`
 * transaction before any action that is admin-only. This is required even
 * though `withTenantContext` already sets the `app.role` GUC RLS reads,
 * because not every admin-only side effect in this plan is an RLS-governed
 * database write — creating a Clerk organization invitation is a call to
 * Clerk's API, which is not proxied through Postgres and so is not subject
 * to RLS at all. Without this explicit check, a non-admin could still
 * trigger `inviteMember`'s Clerk API call by invoking the Server Action
 * directly, even though the corresponding `team_members` insert would
 * separately be blocked by RLS.
 *
 * Throws `NotAdminError` (never returns a falsy value) so every call site
 * fails closed by construction.
 */
export async function assertCallerIsAdmin(
  tx: TenantTx,
  clerkUserId: string,
): Promise<CurrentTeamMember> {
  const member = await findCallerTeamMember(tx, clerkUserId);
  if (!member || member.role !== "admin") {
    throw new NotAdminError();
  }
  return member;
}

/**
 * Standalone version for Server Components (pages), which aren't already
 * inside a `withTenantContext` transaction — opens its own. Returns `null`
 * for a signed-out caller OR a signed-in caller with no `team_members` row
 * yet (e.g. mid-invitation-acceptance, before the Clerk webhook has landed);
 * callers decide what to do with `null` (redirect, show a loading state),
 * this function never guesses.
 */
export async function getCurrentTeamMember(): Promise<CurrentTeamMember | null> {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }
  return withTenantContext((tx) => findCallerTeamMember(tx, userId));
}
