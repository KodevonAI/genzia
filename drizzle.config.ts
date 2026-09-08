import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` diffs schema against local migration snapshots and
// needs no live connection, so DATABASE_URL is only required for commands
// that actually talk to Postgres (`migrate`, `push`, `studio`) — those fail
// naturally with a clear error if it's unset, which is the desired behavior
// rather than throwing here and blocking offline `generate`.
export default defineConfig({
  out: "./drizzle/migrations",
  schema: "./lib/db/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
