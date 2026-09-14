import type { IndexColumn } from "drizzle-orm/pg-core";
import { clientAssignments } from "@/lib/db/schema/client-assignments";

/**
 * Minimal structural transaction type — accepts either the caller's own
 * `TenantTx` (team-member Clerk-session helper) or `IdentityTx` (resolved-
 * identity, non-Clerk helper) without importing either module, both of
 * which are tenant-context-shaped and would poison this file's tsx-safety
 * (see 05-03-PLAN.md's `<interfaces>` section). Only the one drizzle method
 * this file actually calls is required by the shape. `IndexColumn` comes
 * from the (tsx-safe) `drizzle-orm` pg-core subpackage, matching what
 * `.onConflictDoNothing({ target })` actually expects.
 */
type InsertCapableTx = {
  insert: (table: typeof clientAssignments) => {
    values: (value: {
      agencyId: string;
      clientId: string;
      teamMemberId: string;
    }) => {
      onConflictDoNothing: (config: {
        target: IndexColumn | IndexColumn[];
      }) => Promise<unknown>;
    };
  };
};

/**
 * Inserts exactly one `client_assignments` row for `(clientId,
 * teamMemberId)`. Calling this twice for the same pair is a no-op
 * (`onConflictDoNothing`), never an error — the unique index on
 * `(client_id, team_member_id)` (migration 0001) is the arbiter.
 *
 * Extracted verbatim from `assignClient`'s own insert body (`assign-
 * client.ts`) so both the admin-gated assignment flow AND self-assignment
 * on client creation (D-13, plan 05-03's `createClient`) share one insert,
 * without `createClient`'s tsx-safe core importing `assign-client.ts`
 * itself — that file is already tsx-unsafe (it opens a web tenant scope and
 * looks up the caller's own team-membership row). This file imports
 * neither of those.
 */
export async function insertAssignment(
  tx: InsertCapableTx,
  agencyId: string,
  clientId: string,
  teamMemberId: string,
): Promise<void> {
  await tx
    .insert(clientAssignments)
    .values({ agencyId, clientId, teamMemberId })
    .onConflictDoNothing({
      target: [clientAssignments.clientId, clientAssignments.teamMemberId],
    });
}
