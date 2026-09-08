---
phase: 01-fundaciones-cuenta-equipo
plan: 03
type: execute
wave: 3
depends_on: ["01", "02"]
files_modified:
  - lib/storage/r2-client.ts
  - app/api/uploads/brand-logo/route.ts
  - lib/brand/get-brand-config.ts
  - lib/brand/update-brand-config.ts
  - app/[locale]/(dashboard)/settings/brand/page.tsx
  - app/[locale]/(dashboard)/settings/brand/brand-form.tsx
  - messages/es.json
  - messages/en.json
autonomous: true
user_setup:
  - service: cloudflare-r2
    why: "Store the agent's brand logo (CTA-02) — first use of R2 in this project, full asset library comes in Phase 12 (SIS-04)"
    env_vars:
      - name: R2_ACCOUNT_ID
        source: "Cloudflare Dashboard -> R2 -> Overview"
      - name: R2_ACCESS_KEY_ID
        source: "Cloudflare Dashboard -> R2 -> Manage API Tokens -> Create API Token"
      - name: R2_SECRET_ACCESS_KEY
        source: "Cloudflare Dashboard -> R2 -> Manage API Tokens (shown once at creation)"
      - name: R2_BUCKET_NAME
        source: "Cloudflare Dashboard -> R2 -> the bucket created for Genzia assets"
    dashboard_config:
      - task: "Create an R2 bucket for Genzia (e.g. genzia-assets) with public read access for the logo path, or configure a public dev URL"
        location: "Cloudflare Dashboard -> R2 -> Create bucket"
must_haves:
  truths:
    - "An agency admin can set the agent's name, tone, and logo, and those values persist and reload correctly on next visit."
    - "A non-admin team member (once Plan 04 exists) cannot change the brand config, only view it, or the settings page is admin-only entirely."
    - "One agency's brand config is never visible or editable from another agency's session."
    - "Uploading a new logo replaces the old one; the settings page never shows a broken image link."
  artifacts:
    - "lib/db/schema/agent-brand-config.ts (from Plan 01) — read/written exclusively through lib/brand/*.ts"
    - "app/[locale]/(dashboard)/settings/brand — the CTA-02 settings page mounted into Plan 02's dashboard shell"
    - "lib/storage/r2-client.ts — reusable R2 client, the first piece of the storage layer STACK-WEB.md §5 designates for the full asset library later"
  key_links:
    - "Brand form submit -> update-brand-config server action -> withTenantContext -> agent_brand_config row scoped to the caller's agency_id — if this bypasses withTenantContext, a bug could let one agency write another's brand config."
    - "Logo file upload -> R2 presigned PUT -> logo_url stored in agent_brand_config -> rendered in the settings form — if the upload route doesn't validate file type/size before issuing the presigned URL, arbitrary files land in the bucket under the agency's public asset path."
---

<objective>
Let an agency admin configure how the agent presents itself to their clients:
name, tone, and logo (CTA-02) — the white-label identity that later phases'
WhatsApp/portal responses will use.

Purpose: CTA-02 is explicit in PROJECT.md as a first-class part of the agency
account setup, not a later polish item — the agent's client-facing name/tone is
core to the white-label promise ("el cliente final no percibe que usa una
plataforma compartida").

Output: a working settings page reading/writing `agent_brand_config`, plus the
first piece of the R2 storage integration (logo upload) that Phase 12's asset
library will build on.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STACK.md
@.planning/research/STACK-WEB.md
@.planning/phases/01-fundaciones-cuenta-equipo/01-fundaciones-cuenta-equipo-01-SUMMARY.md
@.planning/phases/01-fundaciones-cuenta-equipo/01-fundaciones-cuenta-equipo-02-SUMMARY.md
@lib/tenant/with-tenant-context.ts
@lib/db/schema/agent-brand-config.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: R2 client + presigned logo upload route</name>
  <files>lib/storage/r2-client.ts, app/api/uploads/brand-logo/route.ts</files>
  <action>
    Implement `lib/storage/r2-client.ts`: an S3-compatible client (AWS SDK v3
    `S3Client` pointed at R2's S3 endpoint `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`,
    credentials from `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`) exporting a
    `getPresignedLogoUploadUrl(agencyId: string, contentType: string)` helper
    using `@aws-sdk/s3-request-presigner`'s `getSignedUrl` for a `PutObjectCommand`
    scoped to key `brand-logos/${agencyId}/logo.${ext}` (fixed filename per
    agency — new uploads simply overwrite, satisfying "replaces the old one"
    without needing cleanup logic). Restrict `contentType` to
    `image/png`/`image/jpeg`/`image/webp`, reject anything else before signing.

    Implement `app/api/uploads/brand-logo/route.ts` (`POST`): requires an
    authenticated admin (check via `withTenantContext` — reject with 403 if
    `role !== 'admin'`, this is the app-layer half of the admin-only write;
    Plan 01's RLS policies don't cover this table's write-role restriction
    since agent_brand_config's policy is agency-wide, not role-gated — enforce
    admin-only here explicitly), accepts `{ contentType }` in the JSON body,
    validates it, returns `{ uploadUrl, publicUrl }` (the presigned PUT URL and
    the resulting public R2 URL the client will PUT to and then save,
    respectively). The actual file bytes go directly from the browser to R2 via
    the presigned URL — this route never receives or proxies the file itself.
  </action>
  <verify>`curl -X POST localhost:3000/api/uploads/brand-logo -H "Content-Type: application/json" -d '{"contentType":"image/png"}'` as a signed-in admin returns a presigned URL; `curl -T logo.png "<uploadUrl>"` succeeds and the file is retrievable at `<publicUrl>`; the same request as a non-admin (once Plan 04's roles exist) or with `contentType: "application/exe"` is rejected.</verify>
  <done>Admins can obtain a valid, scoped presigned upload URL for their agency's logo; invalid content types and non-admin callers are rejected before any R2 interaction.</done>
</task>

<task type="auto">
  <name>Task 2: Brand settings page (name, tone, logo) wired to agent_brand_config</name>
  <files>lib/brand/get-brand-config.ts, lib/brand/update-brand-config.ts, app/[locale]/(dashboard)/settings/brand/page.tsx, app/[locale]/(dashboard)/settings/brand/brand-form.tsx, messages/es.json, messages/en.json</files>
  <action>
    Implement `lib/brand/get-brand-config.ts` and `update-brand-config.ts`
    (Next.js Server Actions), both wrapped in `withTenantContext` — get
    performs an upsert-on-read pattern (if no row exists yet for the agency,
    return sensible defaults without creating a row; only `update` actually
    writes a row, via `INSERT ... ON CONFLICT (agency_id) DO UPDATE`). `update`
    validates: `agent_name` non-empty and under 60 chars, `tone` one of a fixed
    set (e.g. `professional | friendly | playful | formal` — a select, not free
    text, to keep this predictable for later prompt-building in Phase 4),
    `logo_url` optional. Reject the call server-side with a clear error if the
    caller's role is not `admin`.

    Build `app/[locale]/(dashboard)/settings/brand/page.tsx` (server component,
    calls `get-brand-config`, renders `<BrandForm initialValues=... />`) and
    `brand-form.tsx` (client component): name text input, tone select, logo
    section (current logo preview if set, file input that on change POSTs to
    `/api/uploads/brand-logo` for a presigned URL, PUTs the file directly to
    R2, then sets the form's `logo_url` field to the returned `publicUrl` —
    show a loading state during upload and a broken-image fallback if the
    preview URL 404s). On submit, calls `update-brand-config`. Show a success
    toast/message on save. Add a link to this page from Plan 02's dashboard nav
    slot. Add the new copy (labels, tone options, success message) to both
    `messages/es.json` and `messages/en.json`.
  </action>
  <verify>As an admin: set name "Sofía" + tone "friendly" + upload a logo, save, reload the page — all three values persist correctly and the logo renders. Attempt the same from a second agency's admin session — confirm the first agency's values never appear. (Non-admin rejection re-verified once Plan 04 lands actual member accounts.)</verify>
  <done>CTA-02 fully working: admin sets agent name/tone/logo, values persist per-agency, reload-safe, never visible cross-agency, write path rejects non-admins.</done>
</task>

</tasks>

<verification>
Manually configure brand settings for two separate agencies (from Plan 02's
onboarding), confirm total independence of their `agent_brand_config` rows and
uploaded logos (distinct R2 keys). Confirm `npm run build` passes.
</verification>

<success_criteria>
- CTA-02 complete: agency admin configures agent name, tone, and logo; values
  persist correctly, scoped per-agency, admin-only to write.
- Logo upload goes directly browser-to-R2 via presigned URL, validated by
  content type before signing.
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundaciones-cuenta-equipo/01-fundaciones-cuenta-equipo-03-SUMMARY.md`
covering: the tone options chosen, the R2 key scheme, and anything Phase 4 (which
will read this config to build the agent's system prompt) needs to know about
its shape.
</output>
