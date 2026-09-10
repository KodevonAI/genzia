# Phase 3: Code Pattern Map

**Purpose:** For every file this phase creates or modifies, show the closest
existing analog in this codebase, with concrete excerpts, so the planner can
write `<action>` blocks with real code shapes instead of vague references.

**Generated:** 2026-09-10
**Sources read directly:** `app/api/webhooks/clerk/route.ts`,
`lib/webhooks/verify-clerk-signature.ts`, `lib/agencies/create-agency.ts`,
`lib/tenant/with-tenant-context.ts`, `lib/tenant/with-resolved-identity-context.ts`,
`lib/identity/resolve-identity.ts`, `lib/identity/types.ts`,
`lib/identity/classify-identity.ts`, `lib/db/index.ts`, `lib/db/schema/*.ts`,
`lib/storage/r2-client.ts`, `drizzle/migrations/0001,0002,0005,0006,0007,0009*.sql`,
`scripts/migrate.ts`, `scripts/verify-identity-resolution.ts`, `.env.example`,
`package.json`

---

## File-by-file map

### 1. `app/api/webhooks/meta/route.ts` (NEW)

**Role:** Next.js Route Handler. `GET` = Meta's one-time verification
handshake. `POST` = every inbound webhook event delivery (messages +
statuses).

**Closest analog:** `app/api/webhooks/clerk/route.ts` (exact structural twin
for the `POST` half — no `GET` handler exists there since Clerk has no
handshake step).

**Concrete shape to copy for POST** (`app/api/webhooks/clerk/route.ts:1-69`):
```typescript
import {
  ClerkWebhookVerificationError,
  verifyClerkWebhookSignature,
} from "@/lib/webhooks/verify-clerk-signature";
import {
  createAgencyFromClerkOrg,
  markAgencyInactiveFromClerkOrg,
} from "@/lib/agencies/create-agency";
import { syncTeamMemberFromClerkMembership } from "@/lib/team/sync-membership";

// `svix` needs Node's crypto module, not the Edge runtime.
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  // The raw body is required for signature verification — reading it any
  // other way (e.g. `request.json()` first) would break verification, since
  // the signature is computed over these exact bytes.
  const rawBody = await request.text();

  let event;
  try {
    event = verifyClerkWebhookSignature(rawBody, { /* headers */ });
  } catch (error) {
    if (error instanceof ClerkWebhookVerificationError) {
      console.warn("Clerk webhook: signature verification failed", error.message);
    } else {
      console.warn("Clerk webhook: signature verification failed", error);
    }
    // Reject before any database write.
    return new Response("Invalid signature", { status: 400 });
  }

  switch (event.type) {
    case "organization.created": { /* ... */ break; }
    default: { /* Unhandled event type — not an error. */ break; }
  }

  return new Response("ok", { status: 200 });
}
```

**What differs for the Meta version (per RESEARCH.md §Architecture Patterns
Pattern 1/2/3):**
- Add a `GET` export for the handshake — no analog exists in this repo, this
  is genuinely new territory. RESEARCH.md's exact code:
  ```typescript
  export async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      // Plain text, NOT Response.json().
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }
  ```
- `POST` swaps `verifyClerkWebhookSignature` (svix headers) for
  `verifyMetaWebhookSignature` (single `x-hub-signature-256` header, see
  file 2 below) but keeps the identical "raw body first, reject before any
  DB write" control flow.
- `switch (event.type)` becomes branching on `value.statuses` vs.
  `value.messages` (RESEARCH.md Anti-Patterns: "Assuming the webhook only
  ever delivers `messages`" — a `statuses`-only payload must not throw).
- Unlike Clerk's handler, this one does real work per message (cross-agency
  lookup → `resolveIdentity` → idempotent insert → `inngest.send`) — still
  keep it a thin orchestrator; push each step into its own `lib/` function,
  matching how the Clerk handler delegates to `lib/agencies/create-agency.ts`
  and `lib/team/sync-membership.ts` rather than inlining logic.
- `runtime = "nodejs"` carries over unchanged — signature verification here
  also needs Node's `crypto`, not Edge.

---

### 2. `lib/webhooks/verify-meta-signature.ts` (NEW)

**Role:** HMAC-SHA256 verification of `X-Hub-Signature-256` over the raw
request body.

**Closest analog:** `lib/webhooks/verify-clerk-signature.ts` — same
responsibility (verify-before-parse, throw a typed error on any failure),
different crypto primitive (raw HMAC vs. svix's wrapped scheme).

**Exact pattern to follow** (`lib/webhooks/verify-clerk-signature.ts:1-61`):
```typescript
import "server-only";
import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/backend";

export class ClerkWebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClerkWebhookVerificationError";
  }
}

export function verifyClerkWebhookSignature(
  rawBody: string,
  headers: { "svix-id": string | null; /* ... */ },
): WebhookEvent {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    throw new ClerkWebhookVerificationError(
      "CLERK_WEBHOOK_SECRET is not set. See .env.example.",
    );
  }
  // ... header presence checks, then verify(), then JSON.parse(rawBody)
}
```

**Concrete replacement body** — RESEARCH.md already worked out the full
implementation (`lib/webhooks/verify-meta-signature.ts`, cited against
`developers.facebook.com/docs/graph-api/webhooks/getting-started`):
```typescript
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export class MetaWebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaWebhookVerificationError";
  }
}

export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): void {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    throw new MetaWebhookVerificationError(
      "META_APP_SECRET is not set. See .env.example.",
    );
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    throw new MetaWebhookVerificationError(
      "Missing or malformed X-Hub-Signature-256 header.",
    );
  }

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");

  if (
    expectedBuf.length !== providedBuf.length ||
    !timingSafeEqual(expectedBuf, providedBuf)
  ) {
    throw new MetaWebhookVerificationError("Signature mismatch.");
  }
}
```

**Key naming/structural conventions preserved from the Clerk analog:**
- `import "server-only";` first line — same as Clerk's file.
- Custom `Error` subclass named `<Provider>WebhookVerificationError`, with
  `this.name` set in the constructor.
- Return type differs deliberately: Clerk's version *returns* the parsed
  event (`JSON.parse(rawBody) as WebhookEvent`) because svix's `.verify()`
  already needs the parsed shape internally; Meta's HMAC check has no such
  need, so `verifyMetaWebhookSignature` returns `void` and the route handler
  does its own `JSON.parse(rawBody)` after calling it — keep parsing in the
  route handler, not the verification module, to match the "verify raw
  bytes, then and only then parse" ordering both webhooks share.
- Env var missing → throw with the exact `"X is not set. See .env.example."`
  message format used everywhere else in this repo (`lib/db/index.ts:21`,
  `lib/tenant/with-tenant-context.ts:59`, `lib/storage/r2-client.ts:32`).

---

### 3. `lib/whatsapp/parse-webhook-payload.ts` (NEW)

**Role:** Typed parsing of `value.messages[]` / `value.statuses[]` after
signature verification — branch on message `type` (`text` | `image` |
`audio` | other) per D-05.

**Closest analog:** None in this repo — Clerk's webhook payload comes
already typed from `@clerk/backend`'s `WebhookEvent`; Meta's Cloud API has no
equivalent official TS SDK type package in use here (RESEARCH.md Standard
Stack: no WhatsApp SDK, native `fetch` only). This is new pattern territory.

**What to reuse from the codebase instead:** the *shape* of
`lib/identity/types.ts` — a single source-of-truth type module with a
discriminated union and short doc-comment explaining why the shape is what
it is. Follow that convention for the parsed-message type, e.g.:
```typescript
export type ParsedInboundMessage =
  | { kind: "text"; from: string; metaMessageId: string; text: string }
  | { kind: "media"; from: string; metaMessageId: string; mediaType: "image" | "audio"; mediaId: string; mimeType: string }
  | { kind: "unsupported"; from: string; metaMessageId: string }
  | { kind: "status"; /* delivery/read receipt, no-op per Pitfall #? */ };
```
- RESEARCH.md's §Alternatives Considered flags `zod` as a defensible but
  first-of-its-kind dependency for this decision — if introduced, it must be
  scoped to this parsing module only and justified explicitly in the plan,
  not silently added to `package.json`.
- `messageType` values stored on the `messages` row must be exactly
  `'text' | 'image' | 'audio' | 'unsupported'` — matches the CHECK constraint
  in file 6 below, not an independently invented enum.

---

### 4. `lib/whatsapp/find-agency-by-whatsapp-number.ts` (NEW)

**Role:** Cross-agency lookup — given a `fromPhoneNumber` on the shared
internal number, find which `agencyId` that team member belongs to, calling
the new `find_agency_by_team_whatsapp_number` SQL function (file 7 below).
This is the resolution step RESEARCH.md's Critical Architecture Gap
identifies as missing before `resolveIdentity` can run at all.

**Closest analog:** No direct analog for the *lookup*, but the calling
convention — a thin wrapper issuing one `sql\`...\`` call via `db.execute`
— matches how `lib/agencies/create-agency.ts` and
`lib/identity/resolve-identity.ts` issue raw `sql` fragments through Drizzle
rather than the query builder for anything that isn't a plain
select/insert/update.

**Pattern to follow** (`lib/identity/resolve-identity.ts:38-39` for the
`sql` + `set_config` idiom, and `lib/tenant/with-resolved-identity-context.ts`
for the `identityDb` import to reuse — do NOT open a third Postgres pool):
```typescript
import { sql } from "drizzle-orm";
import { identityDb } from "@/lib/tenant/with-resolved-identity-context";

/**
 * Cross-agency lookup for the shared internal number (WA-03/WA-04):
 * `resolveIdentity(agencyId, phoneNumber)` requires `agencyId` as an input,
 * but the shared number's webhook doesn't know it yet — this determines it.
 * Calls a narrow SECURITY DEFINER function that returns ONLY `agency_id`,
 * nothing else (RESEARCH.md Critical Architecture Gap) — never widen this
 * to select any other column.
 */
export async function findAgencyByTeamWhatsAppNumber(
  phoneNumber: string,
): Promise<string | null> {
  const [row] = await identityDb.execute<{ agency_id: string | null }>(
    sql`select find_agency_by_team_whatsapp_number(${phoneNumber}) as agency_id`,
  );
  return row?.agency_id ?? null;
}
```
**Critical constraint carried over from `resolve-identity.ts`'s own doc
comment:** this function must run and return BEFORE any
`withResolvedIdentityContext` scope opens — it has no `agencyId` yet, so it
cannot itself run inside a scoped transaction the normal way. It calls the
SECURITY DEFINER function precisely because no GUC-scoped path can answer
this question (that's the whole reason the function exists — see file 7).

**Anti-pattern this file must never do** (RESEARCH.md Anti-Patterns, echoing
SEG-12 / `02-07-SUMMARY.md`): never query `team_members` or
`authorized_contacts` directly from this module as a fallback or "just to
double check" — the SECURITY DEFINER function is the only sanctioned path
that reads `team_members` without an `agency_id` GUC already set.

---

### 5. `lib/whatsapp/send-message.ts` (NEW)

**Role:** Outbound Graph API call — `POST /{phone_number_id}/messages`.

**Closest analog:** `lib/storage/r2-client.ts` — the only existing example
in this repo of a server-only module wrapping a third-party HTTP API with
env-var-sourced credentials, a lazy/explicit-error-on-missing-env pattern,
and no SDK abstraction beyond what's strictly needed (R2 uses the AWS SDK
because S3-compatibility requires request signing; WhatsApp's send call
needs no SDK at all — RESEARCH.md explicitly argues against adding one).

**Pattern element to reuse from `r2-client.ts`** (`lib/storage/r2-client.ts:29-35`):
```typescript
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}
```
Apply the same `requiredEnv` helper (or inline equivalent) for
`META_WHATSAPP_PHONE_NUMBER_ID` / `META_WHATSAPP_ACCESS_TOKEN`, matching the
exact error-message format every other env-gated module in this repo uses.

**Full implementation already specified by RESEARCH.md** (§Code Examples,
cited against `developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages/`,
verified 2026-09-10):
```typescript
// lib/whatsapp/send-message.ts
import "server-only";

const GRAPH_API_VERSION = "v25.0";

export async function sendWhatsAppTextMessage(
  toPhoneNumber: string,
  body: string,
): Promise<{ metaMessageId: string }> {
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    throw new Error(
      "META_WHATSAPP_PHONE_NUMBER_ID / META_WHATSAPP_ACCESS_TOKEN not set. See .env.example.",
    );
  }

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toPhoneNumber,
        type: "text",
        text: { body },
      }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`WhatsApp send failed (${response.status}): ${errorBody}`);
  }

  const json = (await response.json()) as { messages: [{ id: string }] };
  return { metaMessageId: json.messages[0].id };
}
```
**New pattern territory note:** unlike `r2-client.ts` (which lazily
constructs and caches an `S3Client`), there is no persistent client object
here — every call is a stateless `fetch`. This is the first "plain fetch to
a third-party JSON API with a bearer token" module in the repo; no existing
file to copy that specific shape from beyond the env-var-guard convention
above.

---

### 6. `lib/db/schema/messages.ts` (NEW)

**Role:** Drizzle schema for the new `messages` table (D-04).

**Closest analog:** `lib/db/schema/audit-log.ts` — same generation (Phase
2/3 minimal-shell tables with a doc comment explaining scope boundaries),
same `check(...)` constraint style, same `references(() => agencies.id, {
onDelete: "cascade" })` FK pattern. `lib/db/schema/authorized-contacts.ts`
is the closest analog for a `uniqueIndex` with a partial/conditional
`.where(...)` clause.

**Exact schema already specified by RESEARCH.md** (§Code Examples,
`lib/db/schema/messages.ts`) — reuse verbatim as the starting point:
```typescript
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencies } from "./agencies";
import { clients } from "./clients";

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: text("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(),
    channel: text("channel").notNull().default("whatsapp"),
    fromPhoneNumber: text("from_phone_number").notNull(),
    toPhoneNumber: text("to_phone_number").notNull(),
    metaMessageId: text("meta_message_id"),
    resolvedIdentityType: text("resolved_identity_type").notNull(),
    resolvedIdentityId: uuid("resolved_identity_id"),
    messageType: text("message_type").notNull(),
    textBody: text("text_body"),
    mediaId: text("media_id"),
    mediaMimeType: text("media_mime_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("messages_agency_id_meta_message_id_idx")
      .on(table.agencyId, table.metaMessageId)
      .where(sql`${table.metaMessageId} is not null`),
    check("messages_direction_check", sql`${table.direction} in ('inbound', 'outbound')`),
    check("messages_resolved_identity_type_check", sql`${table.resolvedIdentityType} in ('team_member', 'client_contact', 'unknown')`),
    check("messages_message_type_check", sql`${table.messageType} in ('text', 'image', 'audio', 'unsupported')`),
  ],
);
```

**Required companion edit:** add `export * from "./messages";` to
`lib/db/schema/index.ts`, following the existing alphabetical-ish grouping
(`lib/db/schema/index.ts:1-8` — matches how `audit-log`/`authorized-contacts`
were added):
```typescript
export * from "./agencies";
export * from "./team-members";
export * from "./clients";
export * from "./client-assignments";
export * from "./agent-brand-config";
export * from "./authorized-contacts";
export * from "./agent-action-catalog";
export * from "./audit-log";
// + export * from "./messages";
```

**Convention notes the planner must preserve:**
- `resolvedIdentityType`'s three allowed values are a direct mirror of
  `ResolvedIdentity["type"]` in `lib/identity/types.ts:14-22`
  (`'team_member' | 'client_contact' | 'unknown'`) — not a re-invented enum,
  per the schema file's own doc comment.
- `check(...)` constraint naming convention: `<table>_<column>_check`,
  exactly as `audit-log.ts:41` (`audit_log_risk_level_check`) and
  `team-members.ts:29-33` do.
- RLS shape is a plain agency-scoped policy (mirrors `audit_log`'s
  `audit_log_tenant_isolation`), **not** the three-branch admin/member/
  client_contact convention from `0007_client_contact_scope.sql` — see file
  7's migration for the exact reasoning already worked out in RESEARCH.md's
  schema doc comment (no client-portal read of this table exists yet).

---

### 7. `drizzle/migrations/0012_messages_table.sql` (NEW)

**Role:** `CREATE TABLE messages`, its FKs/indexes/checks, RLS policy +
grant, and the new `find_agency_by_team_whatsapp_number` SECURITY DEFINER
function + grant.

**Closest analogs, by section:**
- **`CREATE TABLE` + FK + unique index shape:** `0005_phase2_identity_tables.sql`
  (drizzle-kit-generated — this part of migration 0012 should also be
  drizzle-kit-generated from the schema file above via `npx drizzle-kit
  generate`, not hand-written, matching how 0000/0003/0004/0005/0008 are
  drizzle-generated while 0001/0002/0006/0007/0009 are hand-authored RLS-only
  migrations).
- **RLS policy shape (plain agency isolation):** `0006_phase2_identity_rls.sql`'s
  `audit_log` section (`0006_phase2_identity_rls.sql:76-91`) — copy this
  exactly, renamed to `messages`:
  ```sql
  GRANT SELECT, INSERT, UPDATE, DELETE ON messages TO app_user;
  --> statement-breakpoint

  ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
  --> statement-breakpoint
  ALTER TABLE messages FORCE ROW LEVEL SECURITY;
  --> statement-breakpoint

  CREATE POLICY messages_tenant_isolation ON messages
    USING (agency_id = current_setting('app.agency_id', true))
    WITH CHECK (agency_id = current_setting('app.agency_id', true));
  ```
  **Apply the 0009 fix proactively, don't reintroduce the SEG-12 gap:**
  0009 exists because 0006/0007's original `audit_log`-style policies used
  `coalesce(current_setting('app.role', true), '') <> 'client_contact'`
  (fail-open for `unknown`) or nothing at all. Since this table's write path
  legitimately needs to work for an `unknown`-resolved inbound message too
  (the row must still be written — D-04 says "identidad resuelta del
  remitente" includes `unknown`), do **not** copy 0009's `IN ('admin',
  'member')` restriction verbatim onto `messages` — that would block the
  webhook's own legitimate unknown-identity writes. This is a real
  divergence from the 0009 pattern that needs explicit design in planning,
  not a copy-paste: the RLS policy must allow a write from the
  `withResolvedIdentityContext` unknown branch (agency_id GUC only) while
  still blocking cross-tenant reads. Flag this for the planner as a decision
  point, not a mechanical copy.
- **`NULLIF(...)::uuid` GUC pattern:** if `resolvedIdentityId` (uuid,
  nullable) is ever referenced inside a policy expression, use
  `0002_fix_clients_rls_uuid_cast.sql`'s exact idiom
  (`NULLIF(current_setting('app.xxx', true), '')::uuid`), never a bare
  `::uuid` cast — same pooled-connection GUC-reset failure mode applies.
- **SECURITY DEFINER function shape:** no exact analog exists in this repo
  yet (this is the first SECURITY DEFINER function), but RESEARCH.md has
  already fully specified it, citing `02-07-SUMMARY.md`'s SEG-12 finding as
  precedent for *why* this escape hatch is legitimate:
  ```sql
  CREATE FUNCTION find_agency_by_team_whatsapp_number(p_phone text)
  RETURNS text
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
  STABLE
  AS $$
    SELECT agency_id FROM team_members
    WHERE whatsapp_number = p_phone
    LIMIT 1;
  $$;

  GRANT EXECUTE ON FUNCTION find_agency_by_team_whatsapp_number(text) TO app_user;
  ```
  Contrast with the existing SECURITY INVOKER trigger functions in
  `0006_phase2_identity_rls.sql:115-146` (`authorized_contacts_phone_
  uniqueness_guard`) — those deliberately stay SECURITY INVOKER because both
  tables they touch are already agency-gated-readable by the calling admin;
  this new function is SECURITY DEFINER specifically because the caller has
  no `agency_id` GUC set at all yet, which is the whole problem it solves.
- **Uniqueness follow-on (RESEARCH.md implication 1, Assumption A4 — flag
  for planner decision):** `team_members.whatsapp_number` has no global
  unique constraint today (`lib/db/schema/team-members.ts:25-28` only
  uniques `(agency_id, email)`). RESEARCH.md recommends adding
  `CREATE UNIQUE INDEX ... ON team_members (whatsapp_number) WHERE
  whatsapp_number IS NOT NULL` in this same migration so
  `find_agency_by_team_whatsapp_number`'s `LIMIT 1` is deterministic rather
  than arbitrary — this is a genuine design decision (flagged MEDIUM risk in
  RESEARCH.md's Assumptions Log, A4), not a mechanical copy from precedent;
  the planner must decide explicitly whether to include it.
- **Statement separator convention:** every hand-authored migration in this
  repo uses `--> statement-breakpoint` between statements (see every
  migration read above) — required for `scripts/migrate.ts`'s migrator to
  split the file correctly; do not omit it between sections.

---

### 8. `scripts/verify-whatsapp-webhook-parsing.ts` (NEW)

**Role:** No-network unit test — signature verification (valid/invalid/
missing header) + payload-shape parsing for text/image/audio/statuses.

**Closest analog:** `scripts/verify-identity-classification.ts` — the "pure,
network-free half" pattern this repo already establishes: hand-written
assertion script, no test runner, run via `npx tsx`. Read this file's exact
`check()`/failure-accumulation helpers before writing the new script (not
read in full here, but its existence and role is confirmed via
`verify-identity-resolution.ts`'s own doc comment: "Unlike
`scripts/verify-identity-classification.ts` (the pure, network-free half of
this same test matrix)...").

**Assertion helper pattern to reuse verbatim**, from
`scripts/verify-identity-resolution.ts:43-52`:
```typescript
const failures: string[] = [];

function check(label: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`  [PASS] ${label}`);
  } else {
    console.log(`  [FAIL] ${label} — ${detail}`);
    failures.push(`${label} — ${detail}`);
  }
}
```
Exit-code convention (implied by every `scripts/verify-*.ts` in this repo
and `scripts/migrate.ts:31-34`'s `process.exitCode = 1` on failure): the
script must set `process.exitCode = 1` if `failures.length > 0` at the end,
never throw uncaught or exit 0 on failure.

---

### 9. `scripts/verify-whatsapp-webhook.ts` (NEW)

**Role:** Real-Neon integration test — cross-agency lookup, idempotent
insert, `withResolvedIdentityContext` scoping (covers WA-04 and D-04).

**Closest analog:** `scripts/verify-identity-resolution.ts` — same
structure end to end: seed via `db.batch([...])` with explicit
`set_config` calls in the same batch as the write (this script IS the
privileged setup path, no admin API exists), call the real production
functions (`resolveIdentity`, `withResolvedIdentityContext` — here also
`findAgencyByTeamWhatsAppNumber`), assert against real RLS/trigger/CHECK
behavior, then clean up test data.

**Reuse directly, unmodified:**
- The `check()` / `assertRowCount()` / `errorMessage()` helper trio
  (`scripts/verify-identity-resolution.ts:43-68`).
- The `attemptInsertShouldFail()` / `expectThrows()` helpers
  (`scripts/verify-identity-resolution.ts:76-112`) for asserting the
  idempotent-insert-on-duplicate-`meta_message_id` case (D-04) and any new
  CHECK constraints on `messages`.
- The `db.batch(...)` cast-to-`any[]` convention with the accompanying
  eslint-disable comment (`scripts/verify-identity-resolution.ts:114-121`)
  — same reasoning applies: `db.batch()`'s tuple typing can't express a
  dynamically-built query array, and the runtime assertions are the real
  proof.
- Per-agency test-id randomization: `` `verify-identity-agency-a-${randomUUID()}` ``
  style prefixed ids (`scripts/verify-identity-resolution.ts:124-126`) —
  use an equivalent `verify-whatsapp-*-${randomUUID()}` prefix so test runs
  never collide and are easy to identify/clean up.

**New assertion this script needs that has no direct precedent:** proving
`find_agency_by_team_whatsapp_number` returns the correct agency for a
registered number and `null`/no-match for an unregistered one — model this
as a direct `sql` call assertion the same way `resolve-identity.ts`'s own
lookups are asserted, not a new pattern.

**Companion `package.json` script** (mirrors `db:verify-identity`'s wiring
exactly, `package.json`'s `scripts` block):
```json
"db:verify-whatsapp": "tsx scripts/verify-whatsapp-webhook.ts"
```

---

### 10. `scripts/verify-whatsapp-send.ts` (NEW)

**Role:** Asserts the outbound Graph API request shape (headers, body)
against a stubbed `fetch`, without a live Meta call.

**Closest analog:** No exact precedent (this repo's other `verify-*`
scripts all hit real Neon, never a stubbed external HTTP call) — new
pattern territory for *how* to stub, but the surrounding harness convention
(the `check()` helper, `process.exitCode = 1` on failure, `npx tsx
scripts/...` invocation) still comes directly from
`scripts/verify-identity-resolution.ts` / `scripts/verify-identity-
classification.ts`. A minimal approach consistent with this repo's "no test
framework, no extra dependency" posture: temporarily reassign
`globalThis.fetch` to a capturing stub for the duration of the script, call
`sendWhatsAppTextMessage(...)`, assert on the captured `RequestInit`, then
restore the original `fetch` — no mocking library needed (matches
RESEARCH.md's "Don't Hand-Roll" posture of using built-ins over
dependencies wherever the built-in suffices).

---

### 11. `inngest/client.ts` (NEW — first Inngest integration in repo)

**Role:** Inngest client instance, imported by both the serve handler and
every Inngest function definition.

**Closest analog:** None — `inngest` is not in `package.json` today
(confirmed: `dependencies` list has no `inngest` entry). This is genuinely
new pattern territory. RESEARCH.md's Standard Stack table confirms version
`4.20.0` [VERIFIED: npm registry, 2026-09-10] and that `STACK.md` already
selected Inngest as this project's background-job engine
(`.planning/STACK.md:13,26,46`) — this phase is the first real wiring, not
a new tool choice.

**Convention to apply from the rest of the codebase even though the library
itself is new:** every other singleton client/connection in this repo
(`lib/db/index.ts`'s `db`, `lib/tenant/with-tenant-context.ts`'s `pool`/
`tenantDb`, `lib/storage/r2-client.ts`'s lazy `cachedClient`) is constructed
once at module scope (or lazily cached) and exported directly — no factory
function wrapping it, no DI container. Follow that same shape:
```typescript
import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "genzia" });
```
Install step: `npm install inngest` (per RESEARCH.md's exact installation
note).

---

### 12. `app/api/inngest/route.ts` (NEW)

**Role:** Inngest's own `serve()` HTTP handler, analogous in *position* (an
`app/api/*/route.ts` webhook-shaped endpoint) to
`app/api/webhooks/clerk/route.ts`, but its internals are entirely
Inngest-SDK-generated (`serve({ client: inngest, functions: [...] })`), not
hand-rolled signature verification — the SDK handles that internally. No
in-repo precedent for the SDK-serve pattern itself; follow Inngest's own
`serve()` API for `next` (Next.js App Router) as documented by the
installed package, not an in-repo file. Keep this file limited to wiring
(`export const { GET, POST, PUT } = serve(...)`), same "thin route handler,
real logic lives in `lib/`" discipline as `app/api/webhooks/clerk/route.ts`.

---

### 13. `inngest/functions/send-whatsapp-ack.ts` (NEW)

**Role:** Background function triggered by `"whatsapp/message.received"`,
builds the fixed ack text (D-01), calls `sendWhatsAppTextMessage` (file 5),
and writes the outbound row via `withResolvedIdentityContext` (mirrors
Pattern 3's idempotent-insert-then-async-dispatch shape, but on the
receiving end of that dispatch).

**Closest analog for the *write* half:** `lib/agencies/create-agency.ts`'s
`createAgencyFromClerkOrg` — same idempotent-insert-via-`db.batch`-with-
`set_config`-in-the-same-batch shape, but here through
`withResolvedIdentityContext` (already transaction-wrapped, no manual
`db.batch` needed — see file pattern in
`lib/tenant/with-resolved-identity-context.ts:62-90`):
```typescript
await withResolvedIdentityContext(agencyId, identity, async (tx) => {
  await tx.insert(messages).values({
    agencyId,
    direction: "outbound",
    fromPhoneNumber: platformNumber,
    toPhoneNumber: recipientNumber,
    metaMessageId,
    resolvedIdentityType: identity.type,
    resolvedIdentityId: /* per identity.type, see types.ts */,
    messageType: "text",
    textBody: ackText,
  });
});
```
**No direct analog for the Inngest step/retry wrapper itself** — this is new
pattern territory; follow Inngest's own `step.run(...)` convention (each
side-effecting operation — the Graph API call, the DB write — wrapped in its
own named `step.run` so Inngest's automatic retry applies per-step, not to
the whole function). RESEARCH.md's Don't-Hand-Roll table is explicit: do not
write a custom retry/backoff loop here — that's exactly the plumbing
Inngest's `step.run` already provides.

---

## Summary table

| File | Status | Primary analog | Analog confidence |
|------|--------|-----------------|--------------------|
| `app/api/webhooks/meta/route.ts` | NEW | `app/api/webhooks/clerk/route.ts` | HIGH (POST half); GET handshake has no analog |
| `lib/webhooks/verify-meta-signature.ts` | NEW | `lib/webhooks/verify-clerk-signature.ts` | HIGH — near 1:1 structural mirror |
| `lib/whatsapp/parse-webhook-payload.ts` | NEW | `lib/identity/types.ts` (shape convention only) | LOW — new domain, no direct precedent |
| `lib/whatsapp/find-agency-by-whatsapp-number.ts` | NEW | `lib/identity/resolve-identity.ts` (sql/set_config idiom) | MEDIUM — pattern reused, logic is new |
| `lib/whatsapp/send-message.ts` | NEW | `lib/storage/r2-client.ts` (env-guard convention only) | LOW — new domain, fully specified by RESEARCH.md |
| `lib/db/schema/messages.ts` | NEW | `lib/db/schema/audit-log.ts`, `authorized-contacts.ts` | HIGH — same Drizzle idioms throughout |
| `lib/db/schema/index.ts` | MODIFIED | itself (add one export line) | HIGH |
| `drizzle/migrations/0012_messages_table.sql` | NEW | `0005_*` (table), `0006_*` (RLS), `0002_*`/`0009_*` (GUC cast + fail-closed fixes) | HIGH for table+grant; MEDIUM for RLS policy shape (needs explicit unknown-write decision); NEW for SECURITY DEFINER function |
| `scripts/verify-whatsapp-webhook-parsing.ts` | NEW | `scripts/verify-identity-classification.ts` | HIGH — same no-network harness pattern |
| `scripts/verify-whatsapp-webhook.ts` | NEW | `scripts/verify-identity-resolution.ts` | HIGH — same real-Neon harness pattern |
| `scripts/verify-whatsapp-send.ts` | NEW | none (harness conventions only) | LOW — new stubbed-fetch pattern |
| `inngest/client.ts` | NEW | none (singleton-export convention only) | LOW — first Inngest integration in repo |
| `app/api/inngest/route.ts` | NEW | none (position analog only: `app/api/*/route.ts`) | LOW — SDK-generated internals |
| `inngest/functions/send-whatsapp-ack.ts` | NEW | `lib/agencies/create-agency.ts` (write half only) | MEDIUM for the DB write; LOW for the Inngest step wrapper |
| `package.json` | MODIFIED | itself (add `inngest` dep + `db:verify-whatsapp` script) | HIGH |
| `.env.example` | MODIFIED | itself (add `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_ACCESS_TOKEN`) | HIGH — follow existing per-service comment-block convention (see `.env.example`'s Clerk/R2 sections) |

---

*Pattern map for Phase 3: 03-integraci-n-con-whatsapp-meta*
*Generated: 2026-09-10*
