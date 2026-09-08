import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "@/lib/db/schema";
import type { ResolvedIdentity } from "@/lib/identity/types";

/**
 * The non-Clerk twin of `lib/tenant/with-tenant-context.ts`, and equally
 * security-critical. `withTenantContext` derives the RLS GUCs from an
 * authenticated Clerk session; this function derives them from an identity
 * already resolved from a phone number (`lib/identity/resolve-identity.ts`),
 * because a WhatsApp sender — a client contact, or a team member texting from
 * their phone — has no Clerk session at all (D-06).
 *
 * The GUC contract, identical for both helpers because RLS policies do not
 * and must not know which helper set them:
 *   app.agency_id       always set
 *   app.team_member_id  team_member identities only
 *   app.role            'admin' | 'member' | 'client_contact'
 *   app.client_id       client_contact identities only (added in Phase 2)
 *
 * An `unknown` identity sets nothing beyond `app.agency_id` — deliberately.
 * The fail-closed default in 0001_rls_policies.sql then yields zero rows from
 * every tenant table, which IS SEG-12's guarantee. Do not add a "public" or
 * "guest" branch here to make an unknown sender see something; anything a
 * prospect is allowed to see must come from a source that is not RLS-scoped
 * tenant data.
 *
 * `set_config(..., true)` is transaction-local, not session-local: this
 * connects through Neon's pooler, so a session-local GUC would leak into an
 * unrelated later request that reuses the same physical connection.
 *
 * Driver note: `drizzle-orm/neon-serverless` via `Pool`, never
 * `drizzle-orm/neon-http` — the HTTP driver's `.transaction()` throws, and
 * this helper needs a real multi-statement transaction so the GUCs survive
 * across the caller's arbitrary query sequence.
 *
 * No `import "server-only"` here on purpose: `scripts/verify-identity-
 * resolution.ts` imports this module under plain `tsx`, where the
 * `server-only` package resolves to its throwing entrypoint and would crash
 * the verification run. The module is still unusable in a browser (it opens a
 * Postgres pool from `process.env.DATABASE_URL`).
 */

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. See .env.example.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Shared by this helper and `resolveIdentity`. A separate pool from
 * `with-tenant-context.ts`'s is intentional: that one is created inside a
 * `server-only` module and cannot be imported from a `tsx` script.
 */
export const identityDb = drizzle({ client: pool, schema });

export type IdentityTx = Parameters<
  Parameters<typeof identityDb.transaction>[0]
>[0];

export async function withResolvedIdentityContext<T>(
  agencyId: string,
  identity: ResolvedIdentity,
  fn: (tx: IdentityTx) => Promise<T>,
): Promise<T> {
  return identityDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.agency_id', ${agencyId}, true)`);

    if (identity.type === "team_member") {
      await tx.execute(
        sql`SELECT set_config('app.team_member_id', ${identity.teamMemberId}, true)`,
      );
      await tx.execute(
        sql`SELECT set_config('app.role', ${identity.role}, true)`,
      );
    } else if (identity.type === "client_contact") {
      await tx.execute(
        sql`SELECT set_config('app.role', 'client_contact', true)`,
      );
      await tx.execute(
        sql`SELECT set_config('app.client_id', ${identity.clientId}, true)`,
      );
    }
    // identity.type === "unknown": nothing further is set. Fail-closed by
    // construction — see the header comment and SEG-12.

    return fn(tx);
  });
}
