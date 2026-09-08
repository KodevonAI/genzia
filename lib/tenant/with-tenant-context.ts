import "server-only";
import { auth } from "@clerk/nextjs/server";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "@/lib/db/schema";
import { teamMembers } from "@/lib/db/schema/team-members";

/**
 * THE single most security-critical function in the codebase. Every
 * tenant-scoped query in the application must go through here — never
 * through the plain `db` export in `lib/db/index.ts`. Keep this file small
 * and auditable; do not add branching logic beyond what's described below.
 *
 * What it does, in order, inside one real Postgres transaction:
 *   1. Reads the current Clerk session (`auth()`).
 *   2. Requires a signed-in user AND an active Clerk organization — throws
 *      `NoTenantContextError` otherwise. Callers decide what to do with
 *      that (e.g. redirect to org selection); this function never guesses.
 *   3. Sets `app.agency_id` to the Clerk `orgId` via `set_config(..., true)`
 *      — transaction-local, not session-local. Required, not a style
 *      choice: this connects through Neon's pooler in transaction mode
 *      (STACK-WEB.md §2), so a session-local GUC would leak from one
 *      request into a different, unrelated request that later reuses the
 *      same pooled physical connection.
 *   4. Looks up the caller's `team_members` row by `(agency_id,
 *      clerk_user_id)`. If none exists yet (e.g. mid-invitation-acceptance:
 *      authenticated with Clerk but not yet provisioned as a team member),
 *      `fn` still runs, but with `app.team_member_id` / `app.role` left
 *      unset — RLS policies keyed on those GUCs then correctly resolve to
 *      "no access" (NULL-comparison, see 0001_rls_policies.sql) rather than
 *      throwing. Callers that require a provisioned team member check for
 *      that themselves; this function does not assume it.
 *   5. Sets `app.team_member_id` / `app.role` from that row, if found.
 *   6. Invokes `fn` with the transaction handle and returns its result.
 *
 * Driver note: this uses `drizzle-orm/neon-serverless` (a real, persistent
 * WebSocket connection via `Pool`), deliberately NOT `drizzle-orm/neon-http`
 * (used by `lib/db/index.ts` for schema/migration tooling). Every HTTP call
 * through `neon-http` is independent and stateless — its `.transaction()`
 * throws ("No transactions support in neon-http driver") because there is
 * no persistent session for a transaction-local `set_config` to survive
 * across. This function needs an imperative, multi-step transaction (a
 * lookup whose result decides what happens next, then an arbitrary
 * caller-supplied sequence of queries via `fn`) — only a real connection
 * preserves that session state across statements.
 */

export class NoTenantContextError extends Error {
  constructor() {
    super(
      "No active Clerk session and organization — tenant context cannot be resolved.",
    );
    this.name = "NoTenantContextError";
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. See .env.example.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tenantDb = drizzle({ client: pool, schema });

export async function withTenantContext<T>(
  fn: (tx: Parameters<Parameters<typeof tenantDb.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  const { userId, orgId } = await auth();

  if (!userId || !orgId) {
    throw new NoTenantContextError();
  }

  return tenantDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.agency_id', ${orgId}, true)`);

    const [member] = await tx
      .select({ id: teamMembers.id, role: teamMembers.role })
      .from(teamMembers)
      .where(
        and(eq(teamMembers.agencyId, orgId), eq(teamMembers.clerkUserId, userId)),
      );

    if (member) {
      await tx.execute(
        sql`SELECT set_config('app.team_member_id', ${member.id}, true)`,
      );
      await tx.execute(sql`SELECT set_config('app.role', ${member.role}, true)`);
    }

    return fn(tx);
  });
}
