---
phase: 01-fundaciones-cuenta-equipo
plan: 01
subsystem: foundation-multitenant-rls
tags: [nextjs16, drizzle, neon, postgres-rls, clerk, next-intl, multi-tenant]
requires:
  - PROJECT.md (modelo de identidad y permisos, aislamiento entre clientes)
  - REQUIREMENTS.md (SEG-05 a SEG-08, CTA-01 a CTA-06)
  - STACK.md / research/STACK-WEB.md §2 (RLS como mecanismo estructural de
    aislamiento, Drizzle, Neon, Clerk Organizations)
provides:
  - Next.js 16 app (App Router, TypeScript, Tailwind) with next-intl locale
    routing (es default, en) and Clerk auth wired in
  - Full v1-foundation Drizzle schema (agencies, team_members, clients,
    client_assignments, agent_brand_config) with agency_id on every
    tenant-scoped table
  - Hand-authored RLS migrations: RLS enabled + forced on every tenant-scoped
    table, USING/WITH CHECK policies keyed on app.agency_id/app.team_member_id/
    app.role session GUCs, role-aware clients visibility, non-owner app_user
    role
  - lib/tenant/with-tenant-context.ts — the sole path application code uses
    to reach tenant-scoped tables, over a real transaction (neon-serverless)
  - scripts/verify-rls-isolation.ts — executable proof, run against the real
    Neon database, that cross-agency and cross-role leakage on `clients` is
    impossible at the DB layer
  - scripts/migrate.ts — HTTP-only migration runner (works in WebSocket-
    restricted sandboxes; produces drizzle-kit-compatible tracking rows)
affects:
  - "Plan 01-02 (Clerk webhook -> agency provisioning) — builds directly on
    the agencies/team_members schema and withTenantContext"
  - "Plan 01-03, 01-04 (brand config, team invites) — both read/write through
    withTenantContext and the RLS policies established here"
  - "Every later phase — tenant isolation is structurally enforced here, not
    re-implemented per feature"
tech-stack:
  added:
    - next@16.3.4 (App Router, Turbopack)
    - react@19.2.8 / react-dom@19.2.8
    - drizzle-orm@^0.45.2, drizzle-kit@^0.31.10
    - "@neondatabase/serverless@^1.1.0"
    - "@clerk/nextjs@^7.9.1"
    - next-intl@^4.14.2
    - svix@^2.3.0 (for Plan 02's webhook verification)
    - tsx@^4.23.13 (dev)
  patterns:
    - "RLS-first multi-tenant isolation: every tenant-scoped table has
      FORCE ROW LEVEL SECURITY, policies keyed on current_setting(...,
      true) (missing-is-null), never the error-on-missing form"
    - "Two Neon drivers, deliberately split by need: drizzle-orm/neon-http
      (stateless, plain HTTPS) for unscoped tooling (lib/db/index.ts) and
      the verify script's fixed, known-upfront db.batch() sequences;
      drizzle-orm/neon-serverless (Pool, WebSocket, real transactions) for
      withTenantContext's imperative multi-step + arbitrary-caller-query
      flow, which neon-http's .transaction() cannot do at all"
    - "Non-owner app_user DB role, created with no hardcoded password —
      FORCE ROW LEVEL SECURITY only binds a non-owner role, and a real
      secret never belongs in a committed migration file"
    - "Middleware protects by allowlisting public routes and protecting
      everything else by default, not by matching the (dashboard) route
      group literally (Next.js strips route groups from the actual URL,
      so a literal matcher would silently protect nothing)"
key-files:
  created:
    - package.json / package-lock.json / tsconfig.json / next.config.ts / eslint.config.mjs / postcss.config.mjs
    - middleware.ts
    - i18n/routing.ts, i18n/request.ts
    - app/[locale]/layout.tsx, app/[locale]/page.tsx
    - messages/es.json, messages/en.json
    - .env.example
    - lib/db/index.ts
    - lib/db/schema/{agencies,team-members,clients,client-assignments,agent-brand-config,index}.ts
    - drizzle.config.ts
    - drizzle/migrations/0000_initial_schema.sql
    - drizzle/migrations/0001_rls_policies.sql
    - drizzle/migrations/0002_fix_clients_rls_uuid_cast.sql
    - lib/tenant/with-tenant-context.ts
    - scripts/verify-rls-isolation.ts
    - scripts/migrate.ts
  modified: []
decisions:
  - "Used drizzle-orm/neon-serverless (WebSocket Pool) for withTenantContext
    instead of neon-http, which the plan's Task 2 mandated only for the
    unscoped lib/db/index.ts connection. Task 3 didn't pin a driver, and
    neon-http's .transaction() unconditionally throws ('No transactions
    support in neon-http driver') — it cannot support the imperative,
    multi-step flow (lookup team_member, conditionally set more GUCs, then
    run an arbitrary caller-supplied query sequence) withTenantContext
    needs. neon-serverless is the only option that gives a real, persistent
    transaction."
  - "middleware.ts protects everything except an explicit public allowlist
    (marketing home, future sign-in/sign-up), rather than matching
    '/(dashboard)/**' literally as the plan's prose suggested. Next.js
    strips route-group segments from the real request URL, so a literal
    matcher would never fire — functionally the same protection scope, but
    written the way route groups actually resolve, and safer by
    construction as pages are added under app/[locale]/(dashboard)/** in
    Plan 02 with no further middleware changes needed."
  - "app_user (the RLS-scoped connection role) is created by
    0001_rls_policies.sql with NO password. A real secret is never
    hardcoded into a migration file that lands in git history; the password
    is set out-of-band after migrating (documented in-file and in this
    summary's Authentication/Environment Gates section below)."
  - "scripts/migrate.ts (drizzle-orm/neon-http's own migrator) added
    alongside drizzle-kit migrate. This session's sandboxed execution
    environment cannot reach Neon over WebSocket or raw TCP at all
    (confirmed via the environment's own proxy diagnostics) — only plain
    HTTPS. This migrator produces an identical drizzle.__drizzle_migrations
    tracking row (same hash/schema) so a normal `drizzle-kit migrate` run
    later, from an unrestricted environment, correctly treats these
    migrations as already applied."
metrics:
  duration: "single session (spanning one authentication-gate checkpoint and
    one environment/network-gate checkpoint)"
  completed: "2026-09-08"
---

# Phase 01 Plan 01: Fundaciones — Next.js 16, Drizzle schema, and hand-authored RLS Summary

Postgres Row-Level Security, forced on every tenant-scoped table and keyed on
transaction-local session GUCs set by a single auditable `withTenantContext`
wrapper — proven against a real Neon database via a 7-assertion isolation
script, not assumed.

## What was done

### 1. Next.js 16 app bootstrap (Task 1)

Scaffolded with `create-next-app` (Next.js 16.3.4, App Router, TypeScript,
Tailwind, no `src/`). Installed `drizzle-orm`, `drizzle-kit`,
`@neondatabase/serverless`, `@clerk/nextjs`, `svix` (for Plan 02), and
`next-intl`. Wired `next-intl` locale routing (`es` default, `en`) via
`i18n/routing.ts` / `i18n/request.ts`, moved the root layout/page into
`app/[locale]/`, wrapped them with `ClerkProvider` + `NextIntlClientProvider`,
and added placeholder `messages/{es,en}.json`. Wrote `.env.example`
documenting `DATABASE_URL`, the two Clerk keys, and `CLERK_WEBHOOK_SECRET`
(for Plan 02) with sourcing notes.

### 2. Drizzle schema + hand-authored RLS (Task 2)

Defined the full v1-foundation schema in `lib/db/schema/*.ts`: `agencies`
(keyed directly by the Clerk org id — no surrogate key), `team_members`
(role/status check constraints, unique `(agency_id, email)`), `clients`
(deliberately minimal stub for this phase), `client_assignments` (unique
`(client_id, team_member_id)`), and `agent_brand_config`. Every tenant-scoped
table's `agency_id` FK is `ON DELETE CASCADE` (needed for the verify script's
cleanup, and correct behavior generally). Generated `0000_initial_schema.sql`
via `drizzle-kit generate` and reviewed it.

Hand-authored `0001_rls_policies.sql` (Drizzle Kit doesn't generate RLS —
STACK-WEB.md §2's open RFC): `ENABLE` + `FORCE ROW LEVEL SECURITY` on every
tenant-scoped table, `USING`/`WITH CHECK` policies keyed on
`current_setting('app.agency_id'/'app.team_member_id'/'app.role', true)`
(missing-is-null form throughout), two policies on `clients` (role-aware
`SELECT`, admin-only write), and a non-owner `app_user` role with DML-only
grants and no hardcoded password.

### 3. Tenant context wrapper + isolation proof (Task 3)

`lib/tenant/with-tenant-context.ts`: resolves Clerk `auth()` → requires
`userId` + `orgId` (throws `NoTenantContextError` otherwise) → opens a real
`drizzle-orm/neon-serverless` transaction → `set_config('app.agency_id', ...,
true)` → looks up `team_members` by `(agency_id, clerk_user_id)` →
conditionally sets `app.team_member_id`/`app.role` → invokes the caller's
`fn` inside that same transaction. This is the only code path allowed to
touch tenant-scoped tables.

`scripts/verify-rls-isolation.ts`: seeds two agencies with one client each
and one unassigned `member` team_member (via the raw `db` export, never
`withTenantContext`, using `db.batch([...])` so each GUC-setting + query
sequence runs as one atomic transaction over Neon's HTTP driver). Asserts, in
order: no GUCs → 0 rows; agency-only context (no role) → 0 rows; agency+admin
→ sees exactly its own client (positive control, proves policies aren't just
blocking everything); agency+unassigned member → 0 rows despite the row
existing (must_haves truth #4); agency B's admin never sees agency A's client
(must_haves truth #2). Cleans up via cascading delete in a `finally` block
regardless of pass/fail. **Confirmed passing with all 7 assertions green
against the real Neon database** (see Authentication/Environment Gates
below — this ran on the user's local machine, not in this sandboxed
session).

`middleware.ts` protects every route except an explicit public allowlist
(marketing home, future sign-in/sign-up) rather than matching the
`(dashboard)` route group literally — see Decisions above for why.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] Literal `(dashboard)` route-group middleware matcher would never protect anything**

- **Found during:** Task 3, writing `middleware.ts`
- **Issue:** the plan's prose says middleware should protect
  `app/[locale]/(dashboard)/**`. Next.js strips route-group segments
  (parenthesized folder names) from the actual request URL, so a matcher
  literally targeting that path would never match a real request — a
  silent, total protection no-op for a security-critical app.
- **Fix:** wrote the matcher as an explicit public-route allowlist
  (marketing home + future sign-in/sign-up), protecting everything else by
  default — the same real protection scope, correct for how route groups
  resolve, and automatically covers any future page added under
  `(dashboard)` with no middleware change.
- **Files:** `middleware.ts`
- **Commit:** `34a6283`

**2. [Rule 3 - Blocking] neon-http cannot support `withTenantContext`'s transaction needs**

- **Found during:** Task 3, implementing `with-tenant-context.ts`
- **Issue:** `drizzle-orm/neon-http`'s `.transaction()` unconditionally
  throws (`"No transactions support in neon-http driver"`) — every HTTP
  call through it is independent and stateless, so a transaction-local
  `set_config` can't survive to a later statement. `withTenantContext`
  needs an imperative, multi-step transaction (a lookup whose result
  decides what happens next, then an arbitrary caller-supplied query
  sequence), which is structurally impossible over that driver.
- **Fix:** used `drizzle-orm/neon-serverless` (`Pool`, WebSocket, real
  persistent connection) for `withTenantContext` specifically, keeping
  `neon-http` for `lib/db/index.ts`'s unscoped tooling connection and the
  verify script's fixed, known-upfront `db.batch()` sequences.
- **Files:** `lib/tenant/with-tenant-context.ts`
- **Commit:** `34a6283`

**3. [Rule 3 - Blocking] `drizzle-kit migrate` cannot run in this sandboxed session at all**

- **Found during:** attempting to apply migrations against the real Neon
  database from this session
- **Issue:** `drizzle-kit migrate`'s Neon-detected internal migrator opens a
  WebSocket to apply migrations. This session's execution environment
  categorically rejects WebSocket upgrades and raw-TCP database connections
  through its egress proxy (confirmed via `/root/.ccr/README.md` and the
  proxy's `connect_rejected` log) — and, as it turned out, rejects the
  plain-HTTPS Neon Data API host too (an org-level host policy, not a
  protocol restriction), so no connection method to Neon was reachable from
  this session at all.
- **Fix:** added `scripts/migrate.ts` using `drizzle-orm/neon-http`'s own
  migrator (same plain-HTTPS driver as `lib/db/index.ts`) as a documented
  alternative. It produces an identical `drizzle.__drizzle_migrations`
  tracking row (same schema, same sha256 hash per file), so a real
  `drizzle-kit migrate` run later from an unrestricted environment
  correctly recognizes these migrations as already applied. In the end,
  even this session's host-level Neon block meant migrations had to be
  applied from the user's own machine (see Authentication/Environment
  Gates below) — but `scripts/migrate.ts` is what made that possible
  without needing WebSocket access there either, and remains useful for any
  future WebSocket-restricted environment (CI, other sandboxes).
- **Files:** `scripts/migrate.ts`, `package.json` (`db:migrate`,
  `db:verify-rls` scripts)
- **Commit:** `249f8ba`

**4. [Rule 1 - Bug] Missing `--> statement-breakpoint` markers in `0001_rls_policies.sql` broke `scripts/migrate.ts`**

- **Found during:** the user's local verification run, via
  `npm run db:migrate`
- **Issue:** unlike `0000_initial_schema.sql` (drizzle-kit-generated, which
  inserts `--> statement-breakpoint` between every statement automatically),
  the hand-authored `0001_rls_policies.sql` had none. `drizzle-orm/neon-http`'s
  migrator splits a migration file on that exact marker before executing
  each statement — without it, the whole file was sent as one prepared
  statement and failed: `"cannot insert multiple commands into a prepared
  statement"`.
- **Fix:** added `--> statement-breakpoint` between every statement in
  `0001_rls_policies.sql`.
- **Files:** `drizzle/migrations/0001_rls_policies.sql`
- **Commit:** `a12d1b4` (made in a separate local Claude Code session; this
  summary documents it after reading the actual diff)

**5. [Rule 1 - Bug] UUID cast crash in `clients_select_by_role` under Neon's connection pooling**

- **Found during:** the user's local verification run, via
  `scripts/verify-rls-isolation.ts` running as `app_user` against the real
  database
- **Issue:** `current_setting('app.team_member_id', true)::uuid` crashed
  with `"invalid input syntax for type uuid: \"\""`. Root cause: a custom
  Postgres GUC that has been `SET` at least once on a given physical backend
  connection gets a permanent placeholder — after that, it resets to `''`
  (empty string) at transaction end, not back to `NULL`. Neon's HTTP driver
  reuses physical backend connections across separate requests, so a later
  query on a reused connection could observe `''` instead of `NULL` for a
  GUC nobody set in *that* transaction. Postgres also doesn't guarantee
  short-circuit evaluation of `OR`, so even an admin request (true on the
  left side) could still have the right side's `::uuid` cast evaluated and
  raise.
- **Fix:** `0002_fix_clients_rls_uuid_cast.sql` drops and recreates
  `clients_select_by_role` with `NULLIF(current_setting('app.team_member_id',
  true), '')::uuid` — normalizing the placeholder-reset `''` back to `NULL`
  before the cast, restoring the intended fail-closed "no match" for a GUC
  that isn't meaningfully set.
- **Files:** `drizzle/migrations/0002_fix_clients_rls_uuid_cast.sql`,
  `drizzle/migrations/meta/_journal.json`
- **Commit:** `a12d1b4` (made in a separate local Claude Code session; this
  summary documents it after reading the actual diff — re-verified via
  `scripts/verify-rls-isolation.ts`, all 7 assertions passing)

## Authentication / Environment Gates

Two distinct gates were hit and resolved during this plan, in order:

1. **Credentials gate (Neon + Clerk).** Neither existed at the start of this
   plan. Paused with a `human-action` checkpoint asking the user to create a
   Neon project (pooled connection string) and a Clerk application
   (Organizations enabled, publishable + secret keys) and place them in
   `.env.local`. Resolved: the user provided both. With real Clerk keys in
   place, Task 1's own verification (dev server serving `/es`/`/en` with
   200, `/` redirecting to `/es`) passed cleanly from this session.

2. **Network-egress gate (this session specifically).** Even with valid
   credentials, this sandboxed session's outbound network access rejects
   every Neon host (pooler, Data API, even `console.neon.tech`) and every
   Clerk API host — confirmed directly and documented per
   `/root/.ccr/README.md`'s own guidance ("report the blocked host, don't
   route around it"). This blocked running migrations and the isolation
   script from this session, specifically — not a code or design problem.
   Paused with a second `human-action` checkpoint. Resolved: the user ran
   the full verification chain (`git pull` → `npm install` → `npm run
   db:migrate` → set `app_user`'s password → `npm run db:verify-rls` →
   `npm run build`) on their own machine, which has normal network access.
   Everything passed; their local Claude Code session also caught and fixed
   the two bugs documented above (deviations 4 and 5), committed as
   `a12d1b4`.

## Next Phase Readiness

- `withTenantContext` and the RLS policies are proven against a real
  database — Plan 02 (Clerk webhook → agency provisioning) and every later
  plan should read/write exclusively through `withTenantContext`, never
  `lib/db/index.ts`'s unscoped `db`.
- `app_user`'s password lives only in the user's own `.env.local` / password
  manager — never committed. Any future migration work needs the *owner*
  role's `DATABASE_URL` (DDL rights), not `app_user`'s (DML-only by design).
- This sandboxed execution environment cannot reach Neon or Clerk's APIs at
  all (network policy, not credentials) — future plans in this same kind of
  session should expect the same block for any live-database or live-Clerk-API
  step, and plan for local/CI verification the same way this plan ended up
  doing, rather than re-discovering it.
- `scripts/migrate.ts` is now the project's practical default for applying
  migrations (works everywhere `lib/db/index.ts` already works); reach for
  `drizzle-kit migrate` directly only from an environment with normal
  WebSocket egress.
