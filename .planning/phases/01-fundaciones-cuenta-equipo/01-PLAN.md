---
phase: 01-fundaciones-cuenta-equipo
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - tsconfig.json
  - next.config.ts
  - middleware.ts
  - i18n/routing.ts
  - i18n/request.ts
  - app/[locale]/layout.tsx
  - app/[locale]/page.tsx
  - lib/db/index.ts
  - lib/db/schema/agencies.ts
  - lib/db/schema/team-members.ts
  - lib/db/schema/clients.ts
  - lib/db/schema/client-assignments.ts
  - lib/db/schema/agent-brand-config.ts
  - lib/db/schema/index.ts
  - drizzle.config.ts
  - drizzle/migrations/0000_initial_schema.sql
  - drizzle/migrations/0001_rls_policies.sql
  - lib/tenant/with-tenant-context.ts
  - scripts/verify-rls-isolation.ts
  - .env.example
autonomous: true
user_setup:
  - service: neon
    why: "Postgres database with RLS + branching for tenant isolation (STACK.md)"
    env_vars:
      - name: DATABASE_URL
        source: "Neon Console -> Project -> Connection Details -> pooled connection string, transaction mode"
  - service: clerk
    why: "Agency staff auth via Clerk Organizations (org = agency)"
    env_vars:
      - name: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
        source: "Clerk Dashboard -> API Keys"
      - name: CLERK_SECRET_KEY
        source: "Clerk Dashboard -> API Keys"
    dashboard_config:
      - task: "Enable Organizations feature for the Clerk application (off by default on new instances)"
        location: "Clerk Dashboard -> Organizations Settings -> Enable Organizations"
must_haves:
  truths:
    - "The Next.js app boots and serves a locale-prefixed route (/es, /en) with no runtime errors."
    - "A row inserted directly into `clients` for agency A is never returned by a query executed under agency B's tenant context, even via raw SQL."
    - "A query executed with no tenant context set (no app.agency_id GUC) returns zero rows from any tenant-scoped table, not an error and not all rows."
    - "A team member with role 'member' and no client_assignments row cannot see any row in `clients` through the RLS-scoped connection, even though the row exists in the table."
  artifacts:
    - "lib/db/schema/*.ts — Drizzle schema for agencies, team_members, clients (stub), client_assignments, agent_brand_config, every tenant-scoped table carrying agency_id"
    - "drizzle/migrations/0001_rls_policies.sql — hand-authored RLS policies (USING + WITH CHECK) with FORCE ROW LEVEL SECURITY on every tenant-scoped table"
    - "lib/tenant/with-tenant-context.ts — the single function that resolves Clerk identity to {agency_id, team_member_id, role} and opens a Postgres transaction with those session GUCs set, before any other query runs"
    - "scripts/verify-rls-isolation.ts — executable proof that cross-agency and cross-role leakage is impossible at the DB layer"
  key_links:
    - "Clerk auth() org/user -> withTenantContext() -> set_config('app.agency_id'/'app.team_member_id'/'app.role') -> RLS policy current_setting() checks — if any hop in this chain is skippable, every later phase's isolation guarantee (SEG-05 to SEG-08) is void from day one."
    - "Connection pooling in transaction mode -> GUCs set with set_config(..., true) (transaction-local, not session-local) — if a pooled connection is reused across requests with session-local GUCs, one agency's context can leak into another agency's request."
---

<objective>
Stand up the Genzia repository from nothing: a Next.js 16 app with the App Router,
TypeScript, and locale routing; a Postgres database on Neon with the full v1
tenant-scoped schema; and Row-Level Security enforced at the database layer for
the `agency_id` boundary (with role-aware policies on `clients`, anticipating
CTA-06's per-member visibility). This is pure foundation — no user-facing feature
work — because the repository currently contains only `.planning/`.

Purpose: every other plan in this phase (and every later phase) writes queries
through `lib/db` and `lib/tenant/with-tenant-context.ts`. If tenant isolation is
not structurally correct here, no amount of correct-looking application code in
later plans actually protects client data (STACK-WEB.md §2 explicitly rejects
app-layer-only scoping for exactly this reason).

Output: a running `next dev` app; a Neon database with migrated schema + RLS
policies; a passing isolation-verification script proving cross-agency and
cross-role queries return zero rows, not an error and not everything.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/ROADMAP.md
@.planning/STACK.md
@.planning/research/STACK-WEB.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Bootstrap Next.js 16 app with locale routing and dependencies</name>
  <files>package.json, tsconfig.json, next.config.ts, middleware.ts, i18n/routing.ts, i18n/request.ts, app/[locale]/layout.tsx, app/[locale]/page.tsx, .env.example</files>
  <action>
    Scaffold with `npx create-next-app@latest` (Next.js 16.x, App Router, TypeScript,
    Tailwind, no `src/` dir, App Router yes). Install `drizzle-orm`, `drizzle-kit`,
    `@neondatabase/serverless`, `@clerk/nextjs`, `svix` (webhook signature
    verification, used by Plan 02), `next-intl`.

    Set up `next-intl` for CTA-03 ("multiidioma desde v1"): locales `es` (default)
    and `en`, routing config in `i18n/routing.ts` using `defineRouting`, request
    config in `i18n/request.ts`, and `middleware.ts` combining next-intl's
    `createMiddleware` with Clerk's `clerkMiddleware` (Clerk wraps the outer
    middleware, calls next-intl's middleware for non-API routes; API and webhook
    routes under `app/api/**` must be excluded from locale prefixing). Move the
    scaffolded root page into `app/[locale]/page.tsx` and `app/[locale]/layout.tsx`
    (wrap with `NextIntlClientProvider` and `ClerkProvider`). Create
    `messages/es.json` and `messages/en.json` with a placeholder key so the
    provider has something to load. Do not translate real UI copy yet — later
    plans add their own keys; this task only proves the locale-routing mechanism
    works end to end (Phase 12 does full multi-language verification per
    ROADMAP.md).

    Write `.env.example` listing `DATABASE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
    `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET` (used by Plan 02) with comments on
    where each value comes from (see `user_setup` in frontmatter — do not surface
    that table in chat, just write the comments in the file).
  </action>
  <verify>`npm run dev` starts without errors; `curl -sI http://localhost:3000/es` and `curl -sI http://localhost:3000/en` both return 200; `curl -sI http://localhost:3000/` redirects to `/es` (default locale).</verify>
  <done>Next.js 16 app runs locally, serves both locale prefixes, and all core dependencies (drizzle-orm, @neondatabase/serverless, @clerk/nextjs, svix, next-intl) are installed and resolve with no version conflicts.</done>
</task>

<task type="auto">
  <name>Task 2: Drizzle schema + Neon connection + hand-authored RLS migrations</name>
  <files>lib/db/index.ts, lib/db/schema/agencies.ts, lib/db/schema/team-members.ts, lib/db/schema/clients.ts, lib/db/schema/client-assignments.ts, lib/db/schema/agent-brand-config.ts, lib/db/schema/index.ts, drizzle.config.ts, drizzle/migrations/0000_initial_schema.sql, drizzle/migrations/0001_rls_policies.sql</files>
  <action>
    Define Drizzle schema (`lib/db/schema/*.ts`) for the v1 foundation tables,
    every tenant-scoped table carrying `agency_id text not null references
    agencies(id)`:
    - `agencies`: `id text primary key` (the Clerk organization id — no
      surrogate key, avoids a second mapping table), `name text not null`,
      `plan text not null default 'trial'`, `trial_ends_at timestamptz`,
      `created_at timestamptz not null default now()`.
    - `team_members`: `id uuid primary key default gen_random_uuid()`,
      `agency_id text not null references agencies(id)`, `clerk_user_id text`
      (nullable until the invited user accepts and signs in), `email text not
      null`, `role text not null` (check constraint: `role in ('admin',
      'member')`), `whatsapp_number text`, `status text not null default
      'invited'` (check: `status in ('invited','active','removed')`),
      `invited_at timestamptz not null default now()`, `joined_at timestamptz`.
      Unique index on `(agency_id, email)`.
    - `clients`: `id uuid primary key default gen_random_uuid()`, `agency_id
      text not null references agencies(id)`, `name text not null`,
      `created_at timestamptz not null default now()`. Deliberately minimal —
      this is a stub so CTA-06 (assign clients to team members) and the RLS
      isolation test have something to reference; Phase 5 (CRM) adds the real
      client fields to this same table via a later migration.
    - `client_assignments`: `id uuid primary key default gen_random_uuid()`,
      `agency_id text not null references agencies(id)`, `client_id uuid not
      null references clients(id)`, `team_member_id uuid not null references
      team_members(id)`, `created_at timestamptz not null default now()`.
      Unique index on `(client_id, team_member_id)`.
    - `agent_brand_config`: `agency_id text primary key references
      agencies(id)`, `agent_name text`, `tone text`, `logo_url text`,
      `updated_at timestamptz not null default now()`.

    Configure `lib/db/index.ts` using `@neondatabase/serverless` +
    `drizzle-orm/neon-http` (HTTP driver — no persistent connection to manage,
    fits serverless; use the pooled/transaction-mode `DATABASE_URL`). Export a
    plain `db` instance here for schema/migration tooling only — application
    code must go through `withTenantContext` from Task 3, never import this
    directly for tenant-scoped queries (enforce this as a code-review rule
    noted in a comment at the top of the file).

    Generate the initial migration with `drizzle-kit generate`, review the
    output SQL, then hand-author `drizzle/migrations/0001_rls_policies.sql`
    (Drizzle Kit does not generate RLS — STACK-WEB.md §2 flags this as an open
    RFC). For every tenant-scoped table (`team_members`, `clients`,
    `client_assignments`, `agent_brand_config`; `agencies` gets its own
    single-row policy):
    - `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;`
    - `ALTER TABLE <table> FORCE ROW LEVEL SECURITY;` (the app's DB role must
      not own these tables, or FORCE is a no-op — create and use a non-owner
      `app_user` role for the application's `DATABASE_URL` if the default Neon
      role owns the tables)
    - A `USING` + `WITH CHECK` policy on `agencies` restricting to `id =
      current_setting('app.agency_id', true)`.
    - A `USING` + `WITH CHECK` policy on `team_members`, `client_assignments`,
      and `agent_brand_config` restricting to `agency_id =
      current_setting('app.agency_id', true)`.
    - Two policies on `clients`: a `SELECT`-only `USING` policy allowing
      `agency_id = current_setting('app.agency_id', true) AND
      (current_setting('app.role', true) = 'admin' OR id IN (SELECT client_id
      FROM client_assignments WHERE team_member_id =
      current_setting('app.team_member_id', true)::uuid))`; a separate
      `ALL`-command `WITH CHECK` policy for INSERT/UPDATE/DELETE restricted to
      `agency_id = current_setting('app.agency_id', true) AND
      current_setting('app.role', true) = 'admin'` (only admins mutate the
      client roster in this phase — Phase 5 revisits as CRM permissions grow).
    Use `current_setting(..., true)` (the missing-is-null form) everywhere, not
    the two-argument-less form, so a request with no tenant context set gets
    `NULL` (matches nothing) instead of a Postgres error.

    Run both migrations against the Neon database (`drizzle-kit migrate` or
    equivalent).
  </action>
  <verify>Migrations apply cleanly against a fresh Neon branch; `psql "$DATABASE_URL" -c "\d+ clients"` shows RLS enabled and forced with 2 policies; a raw `SELECT * FROM clients;` run as the app role with no GUCs set returns 0 rows (not an error).</verify>
  <done>Schema exists in Neon exactly as designed; every tenant-scoped table has RLS enabled, forced, and policies keyed on the session GUCs; the app's DB role does not own the tables (FORCE actually takes effect).</done>
</task>

<task type="auto">
  <name>Task 3: Tenant context wrapper + Clerk middleware wiring + isolation proof</name>
  <files>lib/tenant/with-tenant-context.ts, scripts/verify-rls-isolation.ts, middleware.ts</files>
  <action>
    Implement `lib/tenant/with-tenant-context.ts` exporting an async
    `withTenantContext<T>(fn: (tx) => Promise<T>): Promise<T>` that: (1) reads
    the current Clerk session via `auth()` from `@clerk/nextjs/server`, (2)
    requires both a signed-in user and an active `orgId` (throw a typed
    `NoTenantContextError` otherwise — callers decide how to handle, e.g.
    redirect to org selection), (3) opens one Drizzle transaction against the
    Neon connection, and inside it runs `SELECT set_config('app.agency_id',
    $1, true)` with the Clerk `orgId`, then looks up the matching
    `team_members` row by `(agency_id, clerk_user_id)` — if none exists yet
    (user authenticated with Clerk but not yet provisioned as a team member,
    e.g. mid-invitation-acceptance), the caller decides what to do next — then
    runs `SELECT set_config('app.team_member_id', $1, true)` and `SELECT
    set_config('app.role', $1, true)` from that row, and finally invokes `fn`
    with the transaction handle. Use `set_config(..., true)` (transaction-local)
    specifically because the Neon connection runs in pooled transaction mode
    (STACK-WEB.md §2) — session-local GUCs would leak across pooled
    connections between requests. This is the single most security-critical
    function in the codebase; keep it as one small, fully auditable file with
    no branching logic beyond what's described here.

    Update `middleware.ts` (already scaffolded in Task 1) so `clerkMiddleware`
    protects everything under `app/[locale]/(dashboard)/**` (used starting
    Plan 02) — redirect unauthenticated requests to sign-in — while leaving
    marketing/auth routes public. Do not add tenant-resolution logic to
    middleware itself; middleware only gates on "is there a Clerk session,"
    the actual GUC-setting happens per-request inside `withTenantContext`
    (keeps the security-critical logic in one file, not spread across the
    Next.js middleware layer and route handlers).

    Write `scripts/verify-rls-isolation.ts`, a standalone Node script (run via
    `tsx` or `npx tsx`) that, using the raw `db` export (not
    `withTenantContext`, to simulate exactly what RLS alone must block):
    creates two agency rows (A, B), a `clients` row under each, a `team_members`
    row under A with `role='member'` and no `client_assignments` row, then for
    each of: (a) no GUCs set, (b) GUCs set to agency A only, (c) GUCs set to
    agency A + the member's team_member_id/role, runs `SELECT * FROM clients`
    and asserts the exact expected row count (0, 1 only-if-admin-else-0, 0 for
    the unassigned member). Script exits non-zero and prints which assertion
    failed if any check does not hold. Clean up the test rows it creates
    (delete A and B, cascades) at the end regardless of pass/fail.
  </action>
  <verify>`npx tsx scripts/verify-rls-isolation.ts` exits 0 and prints all assertions passed; manually calling `withTenantContext` from a temporary route with a signed-in test user returns only that user's agency's data.</verify>
  <done>withTenantContext is the sole path application code uses to reach tenant-scoped tables; the isolation script proves, against the real Neon database (not mocked), that missing context, wrong agency, and un-assigned member all yield zero rows from `clients`.</done>
</task>

</tasks>

<verification>
Run `npm run build` (catches type errors across the schema/middleware wiring).
Run `npx tsx scripts/verify-rls-isolation.ts` — must pass. Confirm via `psql
"$DATABASE_URL"` that `clients`, `team_members`, `client_assignments`,
`agent_brand_config`, and `agencies` all show `rowsecurity | t` and `forcerowsecurity
| t` in `\d+`. Confirm the app's `DATABASE_URL` role is not the table owner
(`\dt` shows a different owner than the connecting role, or `SELECT
has_table_privilege(...)` checks pass but ownership does not).
</verification>

<success_criteria>
- Next.js 16 app runs with locale routing (`/es`, `/en`) and Clerk middleware wired.
- Full v1-foundation schema exists in Neon via reviewed, hand-authored migrations.
- RLS is enabled AND forced on every tenant-scoped table, with USING + WITH CHECK
  policies keyed on `app.agency_id` / `app.team_member_id` / `app.role` session GUCs.
- `withTenantContext` is the only code path that sets those GUCs, and does so
  transaction-locally (compatible with pooled transaction-mode connections).
- `scripts/verify-rls-isolation.ts` proves cross-agency and cross-role leakage is
  impossible at the database layer, independent of any application code correctness.
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundaciones-cuenta-equipo/01-fundaciones-cuenta-equipo-01-SUMMARY.md`
covering: exact schema decided, the RLS policy shapes, any deviation from this
plan's action (e.g. Neon role setup specifics), and anything Plan 02/03/04
should know before building on top of `withTenantContext`.
</output>
