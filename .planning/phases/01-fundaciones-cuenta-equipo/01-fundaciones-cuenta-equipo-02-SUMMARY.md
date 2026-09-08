---
phase: 01-fundaciones-cuenta-equipo
plan: 02
subsystem: signup-onboarding-dashboard
tags: [clerk-webhooks, svix, next-intl, postgres-rls, organizations, ngrok]
requires:
  - 01-fundaciones-cuenta-equipo-01-SUMMARY.md (Drizzle schema, hand-authored
    RLS, withTenantContext, the raw `db` export)
  - PROJECT.md (CTA-01 self-serve signup + trial; one admin-founder org per
    agency, no org-switcher in v1)
  - REQUIREMENTS.md (CTA-01)
provides:
  - app/api/webhooks/clerk/route.ts — Svix-verified organization.created/
    organization.deleted handler, idempotent, rejects forged requests before
    any DB write
  - lib/agencies/create-agency.ts — createAgencyFromClerkOrg /
    markAgencyInactiveFromClerkOrg, the only code path that writes `agencies`
    rows, using db.batch([set_config, write]) to satisfy RLS from a
    tenant-context-free bootstrap call
  - agencies.status column (active/inactive) + migration 0003
  - app/[locale]/(auth)/sign-up + app/[locale]/(auth)/onboarding — full
    self-serve signup -> agency-naming flow
  - app/[locale]/dashboard — the authenticated shell (nav slots for Plan
    03/04) + trial-status page, reading through withTenantContext
  - i18n/navigation.ts — locale-aware Link/redirect/useRouter, the first use
    of next-intl's createNavigation in this project
affects:
  - "Plan 03 (agent branding, CTA-02) — mounts settings/brand under the
    literal app/[locale]/dashboard/ folder (NOT a `(dashboard)` route
    group — see Deviations) and extends the dashboard nav slot"
  - "Plan 04 (team invites, CTA-04/05/06) — mounts team/ the same way,
    extends the Clerk webhook route with organizationInvitation.accepted/
    organizationMembership.created, and is the plan that finally gives the
    founder admin their own team_members row (see Next Phase Readiness)"
  - "Any future write path to a tenant-scoped table from OUTSIDE
    withTenantContext (bootstrap/webhook code) — must pair set_config with
    the write via db.batch(...), same as this plan's Deviation 3 fix;
    RLS gives no default-safe fallback for a forgotten GUC on a write"
tech-stack:
  added: []
  patterns:
    - "Webhook-triggered tenant bootstrap writes (no tenant context yet)
      still need db.batch([set_config(...), write]) against the raw `db`
      export — RLS's WITH CHECK on agencies_tenant_isolation blocks an
      insert/update with no GUC set exactly the same as it blocks a
      cross-tenant one. withTenantContext is not the only place a GUC has
      to be set; it's the only place it's set FOR YOU."
    - "next-intl's createNavigation (i18n/navigation.ts) for every
      cross-page redirect/link from here on, instead of raw next/navigation
      — keeps the locale prefix automatic and correct."
    - "Dashboard pages under app/[locale]/dashboard/ (literal segment), not
      a `(dashboard)` route group — see Deviations."
key-files:
  created:
    - app/api/webhooks/clerk/route.ts
    - lib/webhooks/verify-clerk-signature.ts
    - lib/agencies/create-agency.ts
    - lib/agencies/trial.ts
    - i18n/navigation.ts
    - app/[locale]/(auth)/sign-up/[[...sign-up]]/page.tsx
    - app/[locale]/(auth)/onboarding/page.tsx
    - app/[locale]/(auth)/onboarding/onboarding-form.tsx
    - app/[locale]/dashboard/layout.tsx
    - app/[locale]/dashboard/page.tsx
    - app/[locale]/dashboard/setting-up-account.tsx
    - drizzle/migrations/0003_agencies_status.sql
  modified:
    - lib/db/schema/agencies.ts (added `status` column)
    - middleware.ts (documented the dashboard route-group pitfall)
    - messages/es.json, messages/en.json (Onboarding + Dashboard strings)
decisions:
  - "app/[locale]/dashboard is a literal path segment, not the `(dashboard)`
    route group the plan's file list implied (mirroring Plan 01's naming
    convention). Route groups strip from the real URL, so
    (dashboard)/page.tsx silently resolved to /[locale] — the exact same URL
    as the marketing homepage (app/[locale]/page.tsx) — and Next.js dropped
    one of the two pages instead of erroring at build time. Caught by
    inspecting the build's own route table (only one /[locale] entry showed
    up when two were expected), not by a build error. Plan 03 and Plan 04
    must nest their pages under the literal dashboard/ folder, not a
    `(dashboard)` group — middleware.ts now documents this explicitly."
  - "Onboarding form uses useOrganizationList().createOrganization +
    setActive exactly as the plan specified, with an added guard in
    onboarding/page.tsx: a signed-in user who already has an orgId is
    redirected straight to the dashboard rather than being shown the form
    again. Without this, navigating back to /onboarding after already
    onboarding would let a founder create a second, orphaned organization —
    a direct violation of PROJECT.md's one-admin-founder-per-agency model."
  - "daysUntilTrialEnd extracted to lib/agencies/trial.ts instead of being
    computed inline in the dashboard page component, purely to satisfy
    eslint's react-hooks/purity rule (it flags Date.now() called directly
    in any component body, Server or Client, and can't tell the two apart)."
metrics:
  duration: "single session, spanning one human-action checkpoint (Clerk
    webhook Dashboard registration + this sandboxed session's Neon/Clerk
    network wall) resolved on the user's own machine, where a real bug was
    found and fixed"
  completed: "2026-09-08"
---

# Phase 01 Plan 02: Sign-up, Clerk webhook, and dashboard shell Summary

Self-serve agency signup (CTA-01) working end-to-end against the real Neon
database and a live, ngrok-exposed Clerk webhook: a visitor signs up, names
an agency, and lands on a dashboard showing a real 14-day trial — with the
`agencies` row created exclusively through a Svix-verified webhook, never
trusted from client input.

## What was done

### 1. Clerk webhook handler syncing organization lifecycle to `agencies` (Task 1)

`lib/webhooks/verify-clerk-signature.ts`: verifies `svix-id`/`svix-timestamp`/
`svix-signature` against `CLERK_WEBHOOK_SECRET` via `svix`'s `Webhook.verify`
(which only validates — it does not hand back the parsed payload — so the
verified raw body is then `JSON.parse`d separately into a typed
`WebhookEvent` from `@clerk/backend`), before anything else touches the
request body.

`app/api/webhooks/clerk/route.ts`: `POST`, `runtime = "nodejs"` (svix needs
Node crypto). Reads the raw body first, verifies it, returns `400` with no DB
write on failure. On success, switches on `event.type`:
`organization.created` → `createAgencyFromClerkOrg`, `organization.deleted` →
`markAgencyInactiveFromClerkOrg`, anything else → `200` immediately
(unhandled, not an error — Clerk retries on non-2xx).

`lib/agencies/create-agency.ts`: `createAgencyFromClerkOrg` inserts with
`id = org.id`, `plan = 'trial'`, `trialEndsAt = now() + interval '14 days'`
(computed in Postgres, not application code) and `ON CONFLICT (id) DO
NOTHING` for idempotency against Clerk's webhook retries.
`markAgencyInactiveFromClerkOrg` sets `status = 'inactive'` rather than
deleting the row, for future audit logging (SEG-11) and to avoid a
cascade-delete of every dependent tenant-scoped table.

`agencies.status` (`active`/`inactive`, default `active`) added via
`drizzle-kit generate` → `drizzle/migrations/0003_agencies_status.sql`
(single `ALTER TABLE ... ADD COLUMN`, no RLS changes needed — the existing
`agencies_tenant_isolation` policy and `app_user`'s table-level grants
already cover the new column).

### 2. Sign-up, onboarding, and dashboard shell (Task 2)

`app/[locale]/(auth)/sign-up/[[...sign-up]]/page.tsx`: Clerk's `<SignUp/>`
at the locale-aware path, `forceRedirectUrl` to `/[locale]/onboarding`.

`app/[locale]/(auth)/onboarding/`: `page.tsx` guards against a user who
already has an `orgId` (redirects straight to the dashboard instead of
letting them create a second organization — see Decisions).
`onboarding-form.tsx` is a single agency-name field; on submit calls
`useOrganizationList().createOrganization({ name })`, then
`setActive({ organization: org.id })` so the session's `orgId` is set
immediately client-side, then `router.push("/dashboard")`.

`app/[locale]/dashboard/`: `layout.tsx` is the shared authenticated shell
with two unlinked nav placeholders ("Branding" for Plan 03, "Team" for Plan
04) and Clerk's `<UserButton/>`. `page.tsx` reads the current agency through
`withTenantContext` (RLS alone restricts the query to the caller's own row,
no explicit `WHERE` needed); if the row doesn't exist yet (webhook lag) it
renders `<SettingUpAccount/>`, a client component that polls via
`router.refresh()` up to 8 times / 2s apart, capped. Once the row exists, it
shows "Trial ends in N days" via `lib/agencies/trial.ts`'s
`daysUntilTrialEnd` (extracted out of the page component — see Decisions).

`i18n/navigation.ts` (new): `createNavigation(routing)` — the first use of
locale-aware `Link`/`redirect`/`useRouter` in this project, needed starting
here for the sign-up → onboarding → dashboard redirect chain.

`messages/{es,en}.json`: `Onboarding` and `Dashboard` keys, including an
ICU plural for the trial-days banner.

## Deviations from Plan

### Auto-fixed issues (this session)

**1. [Rule 1 - Bug] `app/[locale]/(dashboard)` route group collided with the marketing homepage**

- **Found during:** Task 2, first `npm run build` — the route table showed
  only one `/[locale]` entry when both the homepage and the dashboard page
  should have produced separate routes.
- **Issue:** the plan's file list uses `app/[locale]/(dashboard)/page.tsx`,
  mirroring Plan 01's naming convention. Next.js strips route-group segments
  from the real request URL, so that path resolves to `/[locale]` — identical
  to `app/[locale]/page.tsx` (the marketing homepage). Two `page.tsx` files
  resolving to the same URL is a real conflict; Next.js silently kept one and
  dropped the other rather than erroring, which would have shipped either a
  homepage with no reachable dashboard or a dashboard with no reachable
  homepage.
- **Fix:** renamed the folder to the literal `app/[locale]/dashboard/`
  (no parens) so it resolves to its own `/[locale]/dashboard` URL, matching
  every explicit acceptance criterion in the plan (must_haves, verify steps,
  and the redirect targets in Task 2's own action text all say
  `/[locale]/dashboard`). Documented in `middleware.ts` for Plan 03/04, which
  must nest `settings/brand` and `team` under this same literal folder.
- **Files:** `app/[locale]/dashboard/**` (moved), `middleware.ts` (comment)
- **Commit:** `0b8e79f`

**2. [Rule 1 - Bug] `Date.now()` inline in the dashboard page component tripped eslint's `react-hooks/purity` rule**

- **Found during:** Task 2, `npm run lint`
- **Issue:** computing days-until-trial-end inline in `DashboardPage` called
  `Date.now()` directly in the component body; the rule flags any impure
  call there regardless of Server vs. Client Component.
- **Fix:** extracted to `lib/agencies/trial.ts`'s `daysUntilTrialEnd`,
  called from the page instead of computed inline.
- **Files:** `lib/agencies/trial.ts` (new), `app/[locale]/dashboard/page.tsx`
- **Commit:** `0b8e79f`

### Auto-fixed issues (found during the user's local verification, this session's network wall prevented finding it directly — see Authentication/Environment Gates)

**3. [Rule 1 - Bug] `agencies` writes from the Clerk webhook violated RLS — every real signup returned 500**

- **Found during:** the user's local end-to-end test (first real sign-up,
  "Agencia Verificacion A") — the webhook returned `500`
  (Postgres `42501`, insufficient privilege) and the dashboard hung on
  "Estamos preparando tu cuenta..." forever.
- **Issue:** `createAgencyFromClerkOrg`/`markAgencyInactiveFromClerkOrg`
  wrote to `agencies` through the raw `db` export (connects as `app_user`,
  the non-owner role `FORCE ROW LEVEL SECURITY` actually applies to)
  without setting `app.agency_id` first. `agencies_tenant_isolation`'s
  `WITH CHECK` (`0001_rls_policies.sql`) requires that GUC to equal the row
  being written — true even for this bootstrap insert, where no tenant
  context exists yet by design. Skipping the GUC doesn't mean "no tenant
  scoping" (as `lib/db/index.ts`'s doc comment on plain `db` might suggest
  for a read) — for a write, a missing GUC makes `WITH CHECK` evaluate to
  `NULL`, which is not `true`, so the write is rejected outright. This is
  the exact same class of issue as Plan 01's UUID-cast RLS bug: RLS has no
  default-safe fallback for a forgotten GUC on a write, and nothing short of
  actually running the webhook against `app_user` for real would have
  surfaced it — `scripts/verify-rls-isolation.ts` never exercises this write
  path at all.
- **Fix:** paired `set_config` with each write via `db.batch([...])` — the
  same mechanism `scripts/verify-rls-isolation.ts` already uses to combine a
  transaction-local GUC with a query on the stateless `neon-http` driver.
  Verified against a fresh sign-up (agency B): the dashboard showed the
  14-day trial banner immediately.
- **Files:** `lib/agencies/create-agency.ts`
- **Commit:** `cff97c8` (made in the user's local Claude Code session; this
  summary documents it after reading the actual diff via `git show cff97c8`)

## Authentication / Environment Gates

This sandboxed session cannot reach Neon or Clerk's APIs at all — confirmed
again directly this session (`curl` to the Neon pooler host and
`api.clerk.com` both returned `CONNECT tunnel failed, response 403` from the
egress proxy), consistent with `01-fundaciones-cuenta-equipo-01-SUMMARY.md`.
All code (Tasks 1–2), `npm run build`, `npm run lint`, and `npx tsc --noEmit`
were verified from this session; every live-database or live-Clerk-API step
was handed off with a `human-action` checkpoint, exactly as Plan 01 did.

The user completed the full checkpoint from their own machine and reported
back concrete, itemized results:

| Step | Result |
|---|---|
| `git pull` | brought Plan 01-02 (sign-up, onboarding, dashboard, Clerk webhook) |
| Migration `0003_agencies_status` | applied (owner role, then `.env.local` restored to `app_user`) |
| `npm run build` | ok |
| Clerk webhook registered | `https://flounder-pagan-down.ngrok-free.dev/api/webhooks/clerk`, subscribed to `organization.created`/`organization.deleted` |
| Sign-up new user + agency | "Trial ends in 14 days" appeared, persisted across reload |
| Second agency, clean session | isolated — its own independent trial, no cross-contamination |
| Invalid signature on webhook | `400`, no DB write |

The first real sign-up attempt also surfaced Deviation 3 above (webhook
`500`), which the user fixed locally and re-verified with a second agency
before reporting back.

## Next Phase Readiness

- **Plan 03 (branding, CTA-02) and Plan 04 (team, CTA-04/05/06)** — both
  `depends_on: ["01", "02"]` and can now proceed. Both must mount their pages
  under the literal `app/[locale]/dashboard/` folder (not a `(dashboard)`
  route group — see Deviation 1) and extend `app/[locale]/dashboard/layout.tsx`'s
  nav slots.
- **Open gap, not a blocker for Plan 03, but Plan 04 must close it**: the
  founder/admin who signs up via `onboarding-form.tsx` gets a Clerk
  organization membership (Clerk auto-adds the creator as `org:admin`) but
  **no `team_members` row** — Plan 02 only handles
  `organization.created`/`organization.deleted`. Plan 04's own plan already
  scopes `organizationMembership.created` handling (transitioning
  `team_members` from `invited` to `active`), and that same event fires for
  the founder at org-creation time — Plan 04 should confirm its handler
  correctly provisions the *first* admin's `team_members` row too (not just
  invited members), or the founder will hit `withTenantContext`'s "no
  `team_members` row" path (unset `app.role`/`app.team_member_id`) on every
  page that needs role-aware data (e.g. Plan 04's own client-assignment UI).
- **The `db.batch([set_config, write])` pattern (Deviation 3) is now the
  established way to write a tenant-scoped table from outside
  `withTenantContext`** — any future webhook or bootstrap code path (Plan 04's
  invitation-acceptance handler is the next one) must use it explicitly;
  there is no default-safe fallback if the GUC is forgotten, only a hard RLS
  rejection.
- `scripts/verify-rls-isolation.ts` still only exercises `clients` reads
  under an established tenant context — it does not cover writes from a
  tenant-context-free caller (the exact path Deviation 3 broke). Worth
  extending in a future plan if more bootstrap-style writes are added, but
  out of this plan's scope.
