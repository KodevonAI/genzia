---
phase: 01-fundaciones-cuenta-equipo
plan: 03
subsystem: ui
tags: [cloudflare-r2, aws-sdk-v3, presigned-url, next-intl, agent-brand-config]
requires:
  - 01-fundaciones-cuenta-equipo-01-SUMMARY.md (Drizzle schema — agent_brand_config
    table, withTenantContext)
  - 01-fundaciones-cuenta-equipo-02-SUMMARY.md (dashboard shell, nav slot for
    "Branding")
  - PROJECT.md (CTA-02 — white-label agent identity)
  - REQUIREMENTS.md (CTA-02)
provides:
  - lib/storage/r2-client.ts — S3-compatible client (AWS SDK v3) pointed at
    R2's S3 endpoint; getPresignedLogoUploadUrl(agencyId, contentType) scoped
    to a fixed key brand-logos/<agencyId>/logo.<ext>, first piece of the
    storage layer Phase 12 (SIS-04) builds on
  - app/api/uploads/brand-logo/route.ts — POST, admin-only (checked via
    withTenantContext's app.role GUC), validates contentType, returns
    { uploadUrl, publicUrl }; never proxies file bytes
  - lib/brand/tone.ts — BRAND_TONES (professional/friendly/playful/formal),
    the fixed set Phase 4's prompt-building will read
  - lib/brand/get-brand-config.ts / update-brand-config.ts — upsert-on-read +
    admin-gated write, both through withTenantContext
  - app/[locale]/dashboard/settings/brand — the CTA-02 settings page
affects:
  - "Phase 4 (agent conversational core) — reads agent_brand_config's
    agentName/tone/logoUrl to build the agent's system prompt; tone is a
    fixed enum (lib/brand/tone.ts), not free text, specifically so that
    prompt-building can rely on a known, finite list"
  - "Phase 12 (SIS-04, full asset library) — extends lib/storage/r2-client.ts
    rather than building a new R2 client from scratch"
  - "Any future admin-only write to a table whose RLS policy is agency-wide
    (not role-gated) — must re-check role === 'admin' explicitly in the
    Server Action/route, the same way update-brand-config.ts and the
    brand-logo upload route do; RLS alone does not enforce role here"
tech-stack:
  added: ["@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"]
  patterns:
    - "Presigned-URL upload: the app issues a short-lived (300s) presigned
      PUT URL; the browser PUTs file bytes directly to R2, never through a
      Next.js route — keeps large file bytes off the app server entirely."
    - "Fixed per-agency storage key (brand-logos/<agencyId>/logo.<ext>) so a
      re-upload overwrites in place, with no separate delete/cleanup step
      and no risk of one agency's key colliding with another's."
    - "Cache-busting via a client-side version counter bumped only inside
      the upload handler (never Date.now() in the render body — see Plan
      02's Deviation 2 on eslint's react-hooks/purity rule)."
key-files:
  created:
    - lib/storage/r2-client.ts
    - app/api/uploads/brand-logo/route.ts
    - lib/brand/tone.ts
    - lib/brand/get-brand-config.ts
    - lib/brand/update-brand-config.ts
    - app/[locale]/dashboard/settings/brand/page.tsx
    - app/[locale]/dashboard/settings/brand/brand-form.tsx
  modified:
    - .env.example (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
      R2_BUCKET_NAME, R2_PUBLIC_URL)
    - package.json (@aws-sdk/client-s3, @aws-sdk/s3-request-presigner)
    - messages/es.json, messages/en.json (BrandSettings copy)
decisions:
  - "Tone is a fixed 4-value select (professional/friendly/playful/formal),
    not free text — deliberate, so Phase 4's prompt-building can rely on a
    known, finite list instead of parsing arbitrary strings."
  - "agent_brand_config's RLS policy (0001_rls_policies.sql) is agency-wide,
    not role-gated — admin-only write is enforced explicitly in both
    update-brand-config.ts and the brand-logo upload route, not by Postgres.
    Same class of app-layer gate as Plan 04's assertCallerIsAdmin."
  - "Logo upload is presigned-URL, browser-to-R2 direct — the Next.js route
    only ever sees a content-type string, never file bytes, keeping the app
    server out of the upload's data path entirely."
  - "Mounted under the literal app/[locale]/dashboard/ folder Plan 02
    established (not the `(dashboard)` route group the plan's own file list
    named) — same class of fix as Plan 02's Deviation 1, a route group here
    would collide with the existing dashboard route."
metrics:
  duration: "single session"
  completed: "2026-09-08"
---

# Phase 01 Plan 03: Agent brand settings (name, tone, logo) Summary

CTA-02 working end-to-end: an agency admin sets the agent's name, tone, and
logo through `agent_brand_config`, with logo upload going browser-to-R2
directly via a short-lived presigned URL — the Next.js app never touches the
file bytes.

## Accomplishments

- R2 (S3-compatible) storage client + presigned-PUT upload route, admin-gated
- Brand settings page: name input, tone select (4 fixed values), logo upload
  with preview, cache-busting, and broken-image fallback
- `agent_brand_config` read/write exclusively through `lib/brand/*.ts`,
  upsert-on-read (no row created until first save) and upsert-on-write
  (`INSERT ... ON CONFLICT (agency_id) DO UPDATE`)

## Files Created/Modified

- `lib/storage/r2-client.ts` — S3-compatible client, `getPresignedLogoUploadUrl`
- `app/api/uploads/brand-logo/route.ts` — presigned-URL issuer, admin-only,
  validates `contentType` against `image/png|jpeg|webp` before signing
- `lib/brand/tone.ts` — `BRAND_TONES`/`BrandTone`/`BrandConfig`, framework-free
  so both server modules and the client form import it directly
- `lib/brand/get-brand-config.ts` — upsert-on-read via `withTenantContext`
- `lib/brand/update-brand-config.ts` — Server Action, validates `agentName`
  (non-empty, ≤60 chars) and `tone` (fixed set), re-checks `role === 'admin'`
  explicitly, upserts via `ON CONFLICT (agency_id) DO UPDATE`
- `app/[locale]/dashboard/settings/brand/page.tsx` + `brand-form.tsx` —
  settings UI, wired to the dashboard nav slot Plan 02 reserved

## Decisions Made

See frontmatter `decisions`. Key one: `agent_brand_config`'s RLS is
agency-wide (not role-gated), so admin-only enforcement is explicit
application code in two places (the upload route, the update action) —
not something Postgres does for this table.

## Deviations from Plan

**1. [Rule 1 - Bug] `(dashboard)` route group named in the plan's file list would collide with the existing dashboard route**

- **Found during:** Task 2, mounting the settings page
- **Issue:** the plan's file list uses
  `app/[locale]/(dashboard)/settings/brand/*`. As established in Plan 02's
  Deviation 1, a `(dashboard)` route group strips from the real URL and
  would land on the same path space already occupied by the literal
  `app/[locale]/dashboard/` folder.
- **Fix:** mounted under the literal `app/[locale]/dashboard/settings/brand/`
  folder instead, matching Plan 02's established convention.
- **Files:** `app/[locale]/dashboard/settings/brand/page.tsx`, `brand-form.tsx`

**2. [Rule 1 - Bug] `middleware.ts` excluded ALL `/api/**` routes from Clerk's auth context — logo upload always 401'd**

- **Found during:** the user's local end-to-end verification (uploading a
  real logo as a real admin returned `401 Not Authenticated` from
  `/api/uploads/brand-logo`, even though the dashboard itself showed the
  caller correctly signed in).
- **Issue:** `middleware.ts`'s matcher was
  `"/((?!api|trpc|_next|_vercel|.*\\..*).*)"` — a negative lookahead that
  skips `clerkMiddleware` entirely for every `/api/*` request. This was
  correct for `/api/webhooks/clerk` (verified via Svix signature, no user
  session involved) but wrong for any OTHER API route that calls `auth()` —
  without the request passing through `clerkMiddleware`, Clerk has no
  session context to resolve, so `auth()` inside the route handler returns
  no user/org even for a genuinely signed-in caller, and
  `withTenantContext` throws `NoTenantContextError` — indistinguishable
  from an actually-unauthenticated request.
- **Fix:** the matcher now includes `/api/**` and `/trpc/**` so
  `clerkMiddleware` processes them; `isPublicRoute` gained an explicit
  `/api/webhooks(.*)` entry so that one route still skips `auth.protect()`
  (its own Svix check is the real gate). Non-API paths still get next-intl
  routing; API paths short-circuit past it (no locale segment to rewrite).
- **Files:** `middleware.ts`
- **Verified:** logo upload succeeds end-to-end afterward (see below); the
  webhook still correctly rejects an unsigned request with `400` and no DB
  write.

**3. [Infra config, not code] Cloudflare R2 bucket had no CORS policy — browser-to-R2 PUT blocked at preflight**

- **Found during:** the same local verification, immediately after fixing
  Deviation 2 — the presigned-URL fetch succeeded (`200`), but the
  browser's `PUT` to R2 failed with a `403` on the `OPTIONS` preflight.
- **Issue:** R2 buckets have no CORS policy by default; a cross-origin PUT
  from `http://localhost:3000` was rejected before it ever reached the
  presigned-URL logic.
- **Fix:** added a CORS policy to the bucket (Cloudflare Dashboard → R2 →
  bucket → Settings → CORS Policy) allowing `GET`/`PUT`/`HEAD` from
  `http://localhost:3000` and the ngrok tunnel origin. Not a code change —
  infra configuration only, done directly in the Cloudflare dashboard.

---

**Total deviations:** 3 (2 auto-fixed in code, 1 infra config) — all found
only once this plan was exercised end-to-end against real Neon/Clerk/R2
from the user's machine; none were visible from `npm run build` alone.
**Impact on plan:** Deviation 2 is the significant one — a real,
previously-undetected auth gap on every non-webhook API route. Deviation 1
and 3 are naming/infra, no functional risk once fixed.

## Issues Encountered

None beyond the deviations above.

## Verification (completed on the user's local machine, against real Neon/Clerk/R2)

- Set agent name "Sofia Verificacion", tone "Cercano", uploaded a real logo
  file — all three saved and persisted correctly across a full page reload.
- Confirmed cross-agency isolation: `agent_brand_config` has exactly one row,
  scoped to the agency that wrote it (verified directly in Postgres); the
  RLS policy backing this is the same `agencies_tenant_isolation`-style
  agency-scoped policy already proven 7/7 in Plan 01.
- `npm run build` passes with the `middleware.ts` fix in place.

**CTA-02 is fully confirmed working end-to-end.**

## User Setup Required

**External service (Cloudflare R2) required manual configuration** — bucket
creation, public-access dev URL, and API token — done by the user directly in
the Cloudflare dashboard (not tracked as a separate USER-SETUP.md; credentials
were provided directly and added to `.env.local`):

```
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=genzia
R2_PUBLIC_URL=https://pub-....r2.dev
```

## Next Phase Readiness

- **Phase 4 (agent conversational core)** reads `agent_brand_config` to build
  the agent's system prompt — `tone` is guaranteed to be one of
  `lib/brand/tone.ts`'s `BRAND_TONES`, never arbitrary text.
- **Phase 12 (SIS-04, asset library)** extends `lib/storage/r2-client.ts`
  rather than introducing a second R2 client.
- Manual verification is complete (see Verification section above) — CTA-02
  confirmed working end-to-end against real Neon/Clerk/R2. This summary was
  originally backfilled (the code landed via a prior session, commits
  `1be8855`/`e65b47d`, without a SUMMARY.md ever being generated) so
  `/gsd-verify-work 01` would have a source to build this plan's UAT
  checkpoints from; it has since been updated with the actual verification
  results and the two real bugs (Deviations 2-3) that verification found.

---
*Phase: 01-fundaciones-cuenta-equipo*
*Completed: 2026-09-08*
