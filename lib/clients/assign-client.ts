"use server";

import "server-only";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { clientAssignments } from "@/lib/db/schema/client-assignments";
import { clients } from "@/lib/db/schema/clients";
import { NoTenantContextError, withTenantContext } from "@/lib/tenant/with-tenant-context";
import { NotAdminError, assertCallerIsAdmin } from "@/lib/team/current-member";

export type AdminActionResult = { ok: true } | { ok: false; error: "not_admin" };

async function requireOrgContext() {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    throw new NoTenantContextError();
  }
  return { userId, orgId };
}

/**
 * Admin-only (CTA-06): assigns `clientId` to `teamMemberId`. `agency_id` is
 * taken from the caller's own tenant context (`orgId`), never from the
 * client — `client_assignments_agency_consistency` (migration 0004) then
 * verifies at the DB layer that both the referenced client and team member
 * actually belong to that same agency, closing the write-side gap RLS's
 * agency-scoped `USING`/`WITH CHECK` alone doesn't: RLS confirms the row
 * being written matches the CALLER's agency, not that `client_id` and
 * `team_member_id` are internally consistent with each other.
 *
 * `ON CONFLICT DO NOTHING` (the unique `(client_id, team_member_id)` index
 * from Plan 01) makes re-assigning an already-assigned client a harmless
 * no-op, matching the toggle UI's idempotent intent.
 */
export async function assignClient(
  clientId: string,
  teamMemberId: string,
): Promise<AdminActionResult> {
  const { userId, orgId } = await requireOrgContext();

  try {
    await withTenantContext(async (tx) => {
      await assertCallerIsAdmin(tx, userId);
      await tx
        .insert(clientAssignments)
        .values({ agencyId: orgId, clientId, teamMemberId })
        .onConflictDoNothing({
          target: [clientAssignments.clientId, clientAssignments.teamMemberId],
        });
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof NotAdminError) {
      return { ok: false, error: "not_admin" };
    }
    throw err;
  }
}

/** Admin-only (CTA-06): the inverse of assignClient. */
export async function unassignClient(
  clientId: string,
  teamMemberId: string,
): Promise<AdminActionResult> {
  const { userId } = await requireOrgContext();

  try {
    await withTenantContext(async (tx) => {
      await assertCallerIsAdmin(tx, userId);
      await tx
        .delete(clientAssignments)
        .where(
          and(
            eq(clientAssignments.clientId, clientId),
            eq(clientAssignments.teamMemberId, teamMemberId),
          ),
        );
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof NotAdminError) {
      return { ok: false, error: "not_admin" };
    }
    throw err;
  }
}

export type AddClientResult =
  | { ok: true; clientId: string }
  | { ok: false; error: "not_admin" | "invalid_name" };

/**
 * Admin-only, minimal "add client" action — `clients` is only a stub table
 * in this phase (Plan 01 Task 2: id/agency_id/name), just enough to have
 * something real to assign against for CTA-06. Full CRM client intake is
 * Phase 5's CLI-01.
 */
export async function addClient(name: string): Promise<AddClientResult> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, error: "invalid_name" };
  }

  const { userId, orgId } = await requireOrgContext();

  try {
    return await withTenantContext(async (tx) => {
      await assertCallerIsAdmin(tx, userId);
      const [row] = await tx
        .insert(clients)
        .values({ agencyId: orgId, name: trimmed })
        .returning({ id: clients.id });
      return { ok: true, clientId: row.id } as const;
    });
  } catch (err) {
    if (err instanceof NotAdminError) {
      return { ok: false, error: "not_admin" };
    }
    throw err;
  }
}
