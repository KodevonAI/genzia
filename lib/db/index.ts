import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// DO NOT import `db` from this file for tenant-scoped queries. This is a
// plain, unscoped connection for schema/migration tooling (drizzle-kit) and
// for `scripts/verify-rls-isolation.ts`, which deliberately bypasses tenant
// context to prove RLS alone blocks cross-tenant reads (via `db.batch([...])`
// for its fixed, known-upfront GUC + query sequences — see that script). All
// application code must read/write tenant-scoped tables through
// `lib/tenant/with-tenant-context.ts`, which sets the `app.agency_id` /
// `app.team_member_id` / `app.role` session GUCs before any query runs, over
// a real persistent connection (`drizzle-orm/neon-serverless`) — NOT this
// HTTP driver, which is stateless per call and has no `.transaction()`
// support for the imperative, multi-step flow tenant context needs. A query
// issued via this `db` export has no tenant context set — RLS will treat it
// as "no agency," not "every agency" (see the RLS policies in
// drizzle/migrations/0001_rls_policies.sql), but that is not the same as
// being deliberately scoped, so never use it to serve a real request.
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. See .env.example.");
}

const sql = neon(process.env.DATABASE_URL);

export const db = drizzle(sql, { schema });
