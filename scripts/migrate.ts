/**
 * Applies drizzle/migrations/*.sql via the neon-http driver, instead of
 * `drizzle-kit migrate` (its Neon-detected internal migrator uses a
 * WebSocket connection — `Pool` from `@neondatabase/serverless` — which
 * this project's sandboxed execution environment cannot reach: outbound
 * WebSocket upgrades and raw-TCP database connections are not permitted
 * through its egress proxy, only plain HTTPS). `drizzle-orm/neon-http`
 * ships its own migrator built on the same stateless HTTP driver as
 * `lib/db/index.ts`, which works anywhere plain HTTPS does.
 *
 * This produces the IDENTICAL end state `drizzle-kit migrate` would:
 * `drizzle.__drizzle_migrations` gets the same schema, and each row's hash
 * is `sha256` of the full migration file text (exactly `readMigrationFiles`
 * in drizzle-orm/migrator.js) — so a real `drizzle-kit migrate` run later,
 * from an environment with WebSocket egress (Vercel, a developer's own
 * machine, CI), correctly recognizes these migrations as already applied
 * and does not try to re-run them.
 *
 * Usage: `npx tsx scripts/migrate.ts`. Requires DATABASE_URL for a role
 * with DDL rights (the Neon default/owner role) — NOT `app_user`, which
 * 0001_rls_policies.sql creates deliberately without DDL grants.
 */
import { migrate } from "drizzle-orm/neon-http/migrator";
import { db } from "../lib/db";

async function main() {
  await migrate(db, { migrationsFolder: "./drizzle/migrations" });
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exitCode = 1;
});
