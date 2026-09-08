import "server-only";
import { eq, sql } from "drizzle-orm";
import type { DeletedObjectJSON, OrganizationJSON } from "@clerk/backend";
import { db } from "@/lib/db";
import { agencies } from "@/lib/db/schema/agencies";

/**
 * The moment a tenant is born: called only from the `organization.created`
 * Clerk webhook (app/api/webhooks/clerk/route.ts), never from client input.
 * Uses the raw, unscoped `db` export deliberately — there is no tenant
 * context yet for `withTenantContext` to set, since this call is what makes
 * the agency exist in the first place.
 *
 * `ON CONFLICT (id) DO NOTHING` makes this idempotent: Clerk retries
 * webhook deliveries on any non-2xx response, so a re-delivered
 * `organization.created` event for an agency that already has a row must be
 * a silent no-op, not a duplicate-key error or a second (shorter) trial.
 */
export async function createAgencyFromClerkOrg(
  org: OrganizationJSON,
): Promise<void> {
  await db
    .insert(agencies)
    .values({
      id: org.id,
      name: org.name,
      plan: "trial",
      // Computed in Postgres (not `new Date()` in application code) so the
      // 14-day window is anchored to the database's clock, matching every
      // other `trial_ends_at` comparison the app will ever make.
      trialEndsAt: sql`now() + interval '14 days'`,
      status: "active",
    })
    .onConflictDoNothing({ target: agencies.id });
}

/**
 * Called from the `organization.deleted` Clerk webhook. Marks the agency
 * inactive rather than deleting the row — later phases' audit log (SEG-11)
 * must be able to reference a historical agency, and every other
 * tenant-scoped table's `agency_id` foreign key would cascade-delete
 * otherwise.
 */
export async function markAgencyInactiveFromClerkOrg(
  deleted: DeletedObjectJSON,
): Promise<void> {
  if (!deleted.id) {
    return;
  }

  await db
    .update(agencies)
    .set({ status: "inactive" })
    .where(eq(agencies.id, deleted.id));
}
