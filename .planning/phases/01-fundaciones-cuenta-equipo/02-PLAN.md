---
phase: 01-fundaciones-cuenta-equipo
plan: 02
type: execute
wave: 2
depends_on: ["01"]
files_modified:
  - app/api/webhooks/clerk/route.ts
  - lib/webhooks/verify-clerk-signature.ts
  - lib/agencies/create-agency.ts
  - app/[locale]/(auth)/sign-up/[[...sign-up]]/page.tsx
  - app/[locale]/(auth)/onboarding/page.tsx
  - app/[locale]/(auth)/onboarding/onboarding-form.tsx
  - app/[locale]/(dashboard)/layout.tsx
  - app/[locale]/(dashboard)/page.tsx
  - messages/es.json
  - messages/en.json
autonomous: true
user_setup:
  - service: clerk
    why: "Sync agency (org) lifecycle events into our own agencies table"
    dashboard_config:
      - task: "Create a webhook endpoint pointing at /api/webhooks/clerk, subscribed to organization.created and organization.deleted"
        location: "Clerk Dashboard -> Webhooks -> Add Endpoint"
      - task: "Copy the signing secret into CLERK_WEBHOOK_SECRET"
        location: "Clerk Dashboard -> Webhooks -> (the endpoint) -> Signing Secret"
must_haves:
  truths:
    - "A visitor with no account can sign up, name their agency, and land on a dashboard showing an active trial — with no manual step by anyone at Kodevon."
    - "The instant a Clerk organization is created, a matching row exists in `agencies` with a trial_ends_at 14 days out — the two are never out of sync."
    - "Refreshing the dashboard after signup still shows the correct trial state (state survives page reload, not just client-side)."
    - "A forged webhook request (bad/missing Svix signature) is rejected before it can write to `agencies`."
  artifacts:
    - "app/api/webhooks/clerk/route.ts — Svix-verified handler for organization.created/organization.deleted"
    - "app/[locale]/(auth)/onboarding — post-signup flow that creates the Clerk Organization (agency) and names it"
    - "app/[locale]/(dashboard)/layout.tsx + page.tsx — the authenticated shell every later dashboard page (branding, team) mounts into, showing trial status"
  key_links:
    - "Clerk organization.created webhook -> Svix signature verification -> agencies row insert — if verification is skipped, any actor can forge agency rows; if the handler silently fails, a real signup leaves an orgId with no matching agencies row, and withTenantContext's team_members lookup (Plan 01 Task 3) has nothing consistent to resolve against downstream."
    - "Onboarding form submit -> Clerk createOrganization -> webhook (async) -> agencies row — the dashboard shell must handle the brief window where the org exists in Clerk but the webhook hasn't landed yet (poll or optimistic render), not assume synchronous consistency."
---

<objective>
Turn the foundation from Plan 01 into an actual self-serve signup: a visitor
creates an account, names their agency (creating a Clerk Organization), and Meta's
webhook-driven sync gives that agency a real trial-tracked row in Postgres. Lands
on an authenticated dashboard shell that Plan 03 (branding) and Plan 04 (team) both
build their pages into.

Purpose: this is CTA-01 ("registro self-serve... prueba gratis") and the
prerequisite for CTA-02/CTA-04/CTA-05/CTA-06 — nothing else in this phase has an
agency to attach to until this exists.

Output: working sign-up -> onboarding -> dashboard flow; `agencies` rows created
reliably and only via a verified webhook, never trusted from client input directly.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/STACK.md
@.planning/phases/01-fundaciones-cuenta-equipo/01-fundaciones-cuenta-equipo-01-SUMMARY.md
@lib/tenant/with-tenant-context.ts
@lib/db/schema/agencies.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Clerk webhook handler syncing organization lifecycle to `agencies`</name>
  <files>app/api/webhooks/clerk/route.ts, lib/webhooks/verify-clerk-signature.ts, lib/agencies/create-agency.ts</files>
  <action>
    Implement `lib/webhooks/verify-clerk-signature.ts`: a small function using
    `svix`'s `Webhook` class to verify the `svix-id`/`svix-timestamp`/`svix-signature`
    headers against `CLERK_WEBHOOK_SECRET` and the raw request body, returning the
    parsed, typed event or throwing on failure. This must run before anything else
    touches the request body.

    Implement `app/api/webhooks/clerk/route.ts` (`POST`, `export const runtime =
    'nodejs'` since svix needs Node crypto, not Edge): read the raw body (required
    for signature verification — do not use `request.json()` first), verify via
    the helper above (return 400 on failure, no DB write), then switch on
    `event.type`:
    - `organization.created`: call `lib/agencies/create-agency.ts`'s
      `createAgencyFromClerkOrg(event.data)` — inserts an `agencies` row using
      the *raw* `db` export (not `withTenantContext`; there is no tenant context
      yet, this is the moment the tenant is born) with `id = event.data.id`,
      `name = event.data.name`, `plan = 'trial'`, `trial_ends_at = now() +
      interval '14 days'`. Use `ON CONFLICT (id) DO NOTHING` — Clerk retries
      webhooks on non-2xx, so this must be idempotent.
    - `organization.deleted`: mark the matching `agencies` row inactive (add a
      lightweight `status text not null default 'active'` column via a new
      migration `drizzle/migrations/0002_agencies_status.sql` if not already
      present from Plan 01) rather than hard-deleting — later phases' audit log
      (SEG-11, Phase 4) must be able to reference historical agencies.
    - Any other event type: return 200 immediately (unhandled, not an error —
      Clerk expects 2xx or it keeps retrying).
    Always return within a few seconds and do no slow synchronous work
    (STACK-AGENT.md §5's webhook-latency guidance applies to this webhook too,
    even though it's Clerk not Meta).
  </action>
  <verify>Use the Clerk Dashboard's "Send test event" for `organization.created` against the deployed/tunneled endpoint (or `svix-cli` to craft a signed local request) — confirm a matching `agencies` row appears with correct `trial_ends_at`. Re-send the same event id — confirm no duplicate row and no error (idempotency). Send a request with a tampered signature — confirm 400 and no DB write.</verify>
  <done>organization.created reliably produces exactly one agencies row with a 14-day trial; organization.deleted marks it inactive; unverified requests are rejected before touching the database; re-delivery is a no-op.</done>
</task>

<task type="auto">
  <name>Task 2: Sign-up, onboarding (create agency), and dashboard shell</name>
  <files>app/[locale]/(auth)/sign-up/[[...sign-up]]/page.tsx, app/[locale]/(auth)/onboarding/page.tsx, app/[locale]/(auth)/onboarding/onboarding-form.tsx, app/[locale]/(dashboard)/layout.tsx, app/[locale]/(dashboard)/page.tsx, messages/es.json, messages/en.json</files>
  <action>
    Add Clerk's `<SignUp/>` component at `app/[locale]/(auth)/sign-up/[[...sign-up]]/page.tsx`
    (catch-all route Clerk's component requires), configured to redirect to
    `/[locale]/onboarding` after account creation.

    Build `app/[locale]/(auth)/onboarding/page.tsx` + `onboarding-form.tsx`: a
    single form (agency name) that, on submit, calls Clerk's client-side
    `useOrganizationList().createOrganization({ name })` (this is the CTA-01
    self-serve agency-naming step — one Clerk user creates exactly one
    organization here; do not expose Clerk's org-switcher/multi-org UI in v1,
    Genzia's model is one admin-founder per agency at signup). After
    `createOrganization` resolves, call `setActive({ organization: org.id })`
    so the session's `orgId` is set immediately client-side, then redirect to
    `/[locale]/dashboard`. Because the `agencies` row is created asynchronously
    by Task 1's webhook, the dashboard page must tolerate the row not existing
    yet on first render.

    Build `app/[locale]/(dashboard)/layout.tsx`: the shared authenticated shell
    (nav placeholder with slots for "Branding" and "Team" links that Plan 03/04
    will fill in — do not build those pages here) wrapping every page under
    `(dashboard)`. Build `app/[locale]/(dashboard)/page.tsx`: reads the current
    agency via `withTenantContext` (Plan 01 Task 3); if the `agencies` lookup
    inside that call finds no row yet (webhook lag), render a lightweight
    "setting up your account..." state that revalidates after a couple seconds
    (client-side poll or `router.refresh()` on an interval, capped) rather than
    erroring — once the row lands, show "Trial ends in N days" computed from
    `trial_ends_at`.

    Add the handful of new copy strings used here (agency name field label,
    trial banner text, "setting up" message) to `messages/es.json` and
    `messages/en.json` under both locales — this is the first real content
    proving Task 1 of Plan 01's next-intl wiring end to end.
  </action>
  <verify>Manually: sign up as a new user, name an agency, land on `/es/dashboard` (or `/en/dashboard` if browser locale is English) showing "Trial ends in 14 days" (allow a couple seconds for the webhook-driven row to appear). Refresh the page — trial banner persists (reads from DB, not client state). Sign up a second, unrelated user/agency — confirm the first agency's data never appears for the second.</verify>
  <done>A brand-new visitor can go from landing page to a working, trial-tracked dashboard entirely self-serve; the dashboard shell exists for Plan 03 and Plan 04 to extend; no agency ever sees another agency's dashboard state.</done>
</task>

</tasks>

<verification>
End-to-end manual run: sign up two separate agencies in the same browser session
(different users), confirm both onboard independently, both show correct
independent trial banners, and switching between them (separate sessions/incognito)
never cross-contaminates. Confirm `npm run build` passes with the new routes.
</verification>

<success_criteria>
- CTA-01 fully working: self-serve signup with automatic 14-day free trial, zero
  manual intervention.
- `agencies` rows are created exclusively through the verified webhook path —
  never trusted from a client-submitted value.
- The dashboard shell exists and correctly reflects real per-agency trial state
  read through `withTenantContext`, ready for Plan 03/04 to add pages into.
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundaciones-cuenta-equipo/01-fundaciones-cuenta-equipo-02-SUMMARY.md`
covering: the exact onboarding UX decided, webhook event handling details, and
the dashboard layout's extension points (nav slots) that Plan 03/04 should use.
</output>
