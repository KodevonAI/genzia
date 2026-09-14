import "server-only";
import { eq, ilike, or } from "drizzle-orm";
import { clients } from "@/lib/db/schema/clients";
import { clientAssignments } from "@/lib/db/schema/client-assignments";
import { withTenantContext } from "@/lib/tenant/with-tenant-context";

export type ClientRow = typeof clients.$inferSelect;

/**
 * Every `clients` row visible to the caller, optionally narrowed by a
 * case-insensitive substring `query` against name/industry/notes (Phase 5
 * CRM search). Deliberately no manual role-based filtering here — Plan 01's
 * `clients_select_by_role` RLS policy already does exactly that (admin:
 * every client in the agency; member: only clients assigned to them via
 * `client_assignments`), and duplicating that logic in application code is
 * the exact anti-pattern STACK-WEB.md §2 warns against: trust the database,
 * don't re-implement its access rules here where they could silently drift
 * out of sync. `query` absent/blank is byte-identical to the pre-Phase-5
 * behavior — no regression to the two existing zero-argument call sites
 * (dashboard/page.tsx, team/[memberId]/page.tsx).
 */
export async function listClients(query?: string): Promise<ClientRow[]> {
  const trimmed = query?.trim();
  if (!trimmed) {
    return withTenantContext((tx) => tx.select().from(clients).orderBy(clients.name));
  }

  const pattern = `%${trimmed}%`;
  return withTenantContext((tx) =>
    tx
      .select()
      .from(clients)
      .where(
        or(
          ilike(clients.name, pattern),
          ilike(clients.industry, pattern),
          ilike(clients.notes, pattern),
        ),
      )
      .orderBy(clients.name),
  );
}

/**
 * The exact inverse of `listAssignedClientIds`: every `teamMemberId`
 * currently assigned to `clientId`, for the client ficha's own "assigned
 * team members" view (Phase 5 CRM).
 */
export async function listAssignedTeamMemberIds(clientId: string): Promise<string[]> {
  return withTenantContext(async (tx) => {
    const rows = await tx
      .select({ teamMemberId: clientAssignments.teamMemberId })
      .from(clientAssignments)
      .where(eq(clientAssignments.clientId, clientId));
    return rows.map((row) => row.teamMemberId);
  });
}

/**
 * The ids of every client currently assigned to `teamMemberId`, for
 * rendering the admin-only assignment toggle UI (Task 2). Only meaningful
 * when called by an admin — a member's own RLS-limited view of `clients`
 * already IS this same information for themselves, expressed as row
 * visibility rather than an explicit assignment list.
 */
export async function listAssignedClientIds(teamMemberId: string): Promise<string[]> {
  return withTenantContext(async (tx) => {
    const rows = await tx
      .select({ clientId: clientAssignments.clientId })
      .from(clientAssignments)
      .where(eq(clientAssignments.teamMemberId, teamMemberId));
    return rows.map((row) => row.clientId);
  });
}
