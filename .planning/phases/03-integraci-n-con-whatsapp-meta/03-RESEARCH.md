# Phase 3: Integración con WhatsApp/Meta - Research

**Researched:** 2026-09-10
**Domain:** WhatsApp Cloud API webhook + outbound send integration, Next.js Route Handlers, Postgres/RLS persistence
**Confidence:** MEDIUM-HIGH (implementation mechanics HIGH — verified against current official docs; one architectural gap found that needs a planning decision, flagged LOW/Open Question)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (Alcance entra/sale):** This phase covers the full inbound + outbound
  pipeline, but with trivial content: the webhook receives a real message,
  resolves identity (team/contact/unknown), and the system sends back a fixed
  message (e.g. "Mensaje recibido") via Meta's real send API — not just a 200
  OK to the webhook. This proves outbound sending works (permissions, format,
  rate limits) before Phase 4 depends on it for real responses. No LLM
  response generation in this phase — that's exclusively Phase 4.
- **D-02 (Secuenciación con Meta):** Genzia's business verification with Meta
  is still pending. This phase starts NOW using the free developer
  test number/WABA Meta gives to any unverified developer — it does not wait
  for the legal process to build and test the pipeline.
- **D-03 (Embedded Signup diferido):** No Embedded Signup UI (WA-02) in this
  phase. Per-agency WhatsApp connection onboarding is built once Meta approves
  Genzia's business verification. This phase is platform-side only: webhook,
  identity, send — all tested against the fixed test number (no per-agency
  connection UI yet).
- **D-04 (Persistencia de mensajes):** A new, minimal table (exact name at
  planning's discretion, e.g. `messages`) is created for the raw log of
  inbound/outbound messages (content, direction, resolved sender identity,
  timestamp, channel). Deliberately separate from `audit_log` (Phase 2,
  schema-only) — `audit_log` is reserved for agent actions/decisions
  (approvals, risk changes) in later phases; mixing raw messages into it
  would contaminate its documented purpose (`02-02-SUMMARY.md`).
- **D-05 (Alcance de medios):** This phase handles text messages end-to-end
  only. Audio/image messages: detect type and save Meta's `media_id`
  reference, without downloading, transcribing, or interpreting content —
  download (to R2) and interpretation (Deepgram for voice, Claude vision for
  images, already researched in `research/STACK-AGENT.md` §3-4) are Phase 4.

### Claude's Discretion

- Exact name/column structure of the messages table (D-04).
- Technical mechanism for async webhook processing (Inngest, already chosen
  in STACK.md but not yet installed/wired in the repo — research confirms the
  webhook must respond fast and process separately).
- Webhook error handling (Meta retries, timeouts, malformed payloads).
- Testing approach given this phase depends on real Meta credentials (test
  WABA) — likely similar to Phase 1/2's pattern: some steps require running
  from a machine/session with real network access and the user's own
  credentials, not assumable in a sandboxed session.

### Deferred Ideas (OUT OF SCOPE)

- **Real Embedded Signup UI** (WA-02) — built once Meta approves Genzia's
  business verification; not part of this phase (D-03).
- **Audio/image interpretation** (Deepgram, Claude vision) — Phase 4, once
  the conversational agent exists to consume that media (D-05).
- **Real agent response generation** — Phase 4 (core conversational agent);
  this phase only proves the pipeline with a fixed ack (D-01).
- **Full visible conversation history/bitácora table** — Phase 4; this phase
  only creates a minimal raw record (D-04).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WA-01 | Genzia opera como Tech Provider oficial de Meta — sin BSP intermediario. | §Architecture Patterns confirms the test-WABA path used in this phase requires no BSP and no completed Tech Provider verification — direct Graph API calls only, matching WA-01's end-state shape from day one. §Common Pitfalls #8 (token type) and §State of the Art (Embedded Signup v4) keep the implementation forward-compatible with the eventual Tech Provider-verified flow. |
| WA-02 | Cada agencia conecta su propio número vía Embedded Signup. | Explicitly deferred (D-03) — not implemented this phase. §State of the Art documents the v4-not-v2 requirement so no near-term migration is needed once WA-02 is built. |
| WA-03 | Número único de la plataforma, compartido entre agencias, para conversaciones internas del equipo. | §Env Vars and §Architecture Patterns wire this phase's single test WABA/phone_number_id as the stand-in for this shared internal number via env vars, not a per-agency DB row. |
| WA-04 | El sistema identifica la agencia de cada miembro por su registro, no por el número al que escribe. | §Critical Architecture Gap — the central finding of this research: Phase 2's `resolveIdentity(agencyId, phoneNumber)` requires `agencyId` as an input, but the shared internal number's webhook does not know which agency a sender belongs to in advance. A new cross-agency lookup step is required before `resolveIdentity` can run. |
| WA-05 | El agente entiende texto, notas de voz e imágenes (WhatsApp y web). | Scoped by D-05 to text-only interpretation this phase; audio/image are detected and their `media_id` stored, not processed. §Code Examples shows the webhook payload branch for each `type`. |
| WA-07 | El costo de conversación se traslada a la agencia de forma transparente. | §State of the Art documents the 2025/2026 shift to per-message pricing and the free "Service" category for free-form replies inside the 24h window — this phase's fixed ack is a Service-category reply (no cost), so WA-07's cost pass-through logic is not exercised yet, but §Standard Stack's messages-table schema reserves fields so Phase 4+ (template-based COB-03/CAL-03 sends) doesn't need a schema migration to add cost tracking. |
</phase_requirements>

## Summary

STACK-AGENT.md §5 already covers the Tech Provider Program, Embedded Signup
v4 vs. deprecated v2, the 24h window/template mechanic, and the two-number
model at the product-decision level. This research fills the
implementation-level gap: the exact webhook verification handshake, signature
verification, idempotency, outbound send request shape, and — most
importantly — a **structural gap between Phase 2's identity-resolution
contract and Phase 3's actual webhook shape** that must be resolved during
planning, not discovered during implementation.

**Primary recommendation:** Build one Next.js Route Handler
(`app/api/webhooks/meta/route.ts`) that handles both the `GET` verification
handshake and the `POST` event delivery, mirroring the existing Clerk webhook
pattern (`app/api/webhooks/clerk/route.ts`) exactly for raw-body signature
verification and idempotent-write semantics. Do the identity-resolution and
raw-message-persistence work **synchronously** inside the webhook handler
(it's a couple of fast, already-built DB calls) and only offload the
**outbound Graph API send** to an Inngest background function — install and
wire Inngest now, since STACK.md already selected it and Phase 4's LLM calls
will need durable async execution anyway; retrofitting it later is riskier
than adding it now while the webhook is still simple. Before any of this
resolves an identity, **a new cross-agency phone-number lookup must run
first** (§Critical Architecture Gap) because the shared internal number
(WA-03/WA-04) receives messages from team members across every agency, and
Phase 2's `resolveIdentity` cannot be called without already knowing the
`agencyId`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Webhook GET verification handshake | API/Backend | — | Stateless echo of `hub.challenge`, no DB needed |
| Webhook POST signature verification (HMAC-SHA256) | API/Backend | — | Must run before any DB write, over raw body bytes, same shape as existing Clerk/Svix verification |
| Cross-agency phone → agency lookup | Database/Storage | API/Backend | Needs a narrow RLS-bypassing SQL function (SECURITY DEFINER) — the escape hatch itself lives in Postgres, invoked from the API tier |
| Identity resolution (`resolveIdentity`) | API/Backend | Database/Storage | Existing Phase 2 code; reused as-is once `agencyId` is known |
| Idempotent raw message persistence | Database/Storage | API/Backend | Postgres `ON CONFLICT DO NOTHING` on Meta's message id is the actual dedup mechanism |
| Async outbound send orchestration | API/Backend (background) | — | Inngest function, decoupled from the request/response cycle of the webhook itself |
| Outbound Graph API send (ack message) | API/Backend | External (Meta Graph API) | Server-side `fetch` call with a long-lived token; no client/browser involvement |
| Media reference storage (`media_id`, no download) | Database/Storage | — | D-05: store the pointer only, no R2/CDN interaction this phase |
| Media download + interpretation | Out of scope (Phase 4) | — | Explicitly deferred |

## Critical Architecture Gap: Agency Resolution for the Shared Internal Number

This is the most important finding of this research and should be resolved
during planning, not discovered mid-implementation.

**The problem:** `resolveIdentity(agencyId, phoneNumber)`
(`lib/identity/resolve-identity.ts`, Phase 2) and
`withResolvedIdentityContext(agencyId, identity, fn)`
(`lib/tenant/with-resolved-identity-context.ts`) both **require `agencyId` as
an input parameter** — they were designed for contexts where the agency is
already known (a Clerk-authenticated session has `orgId`). WA-04 and
`PROJECT.md` §"Dos números de WhatsApp" are explicit that the shared internal
platform number (WA-03) is used by **team members across every agency**, and
"the system identifies which agency a person belongs to by their
registration, not by the number they write to." That means: **when an
inbound webhook arrives on the shared internal number, the code does not yet
know which `agencyId` to pass to `resolveIdentity`** — determining the
agency IS the first step of identity resolution here, not a precondition of
it.

**Why this can't be solved by "just query `team_members` without a GUC":**
`team_members` has `FORCE ROW LEVEL SECURITY`
(`0001_rls_policies.sql`/`0006_phase2_identity_rls.sql`) and every existing
policy requires `app.agency_id = current_setting('app.agency_id', true)`. A
query issued through `app_user` with no `app.agency_id` GUC set returns
**zero rows**, not "all agencies" — RLS fails closed, by design. There is
currently no code path in the repo that looks up a `team_members` row by
`whatsapp_number` alone, across all agencies. This is structurally the same
category of problem as the open SEG-12 gap documented in
`02-07-SUMMARY.md` (a read that legitimately needs to happen before a scope
is established, indistinguishable at the GUC level from a read that should
be blocked) — except here it's worse: SEG-12's resolution step at least knew
`agencyId` already; this one doesn't even have that.

**Recommended solution — a narrow SECURITY DEFINER function, not a bypass
role for general queries:**

```sql
-- Migration 0012 (or wherever this phase's migration lands)
-- Returns ONLY the agency_id for a WhatsApp number registered as a team
-- member somewhere — never role, name, or any other column. SECURITY
-- DEFINER runs as the function owner (bypassing the caller's RLS context
-- for this one narrow, auditable read), which is exactly the kind of
-- deliberately-scoped escape hatch 02-07-SUMMARY.md's SEG-12 finding
-- anticipated as one of the two legitimate fixes for this class of problem.
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

Application flow for the shared internal number's webhook:
1. `agencyId := findAgencyByTeamWhatsAppNumber(fromPhone)` (thin wrapper
   calling the SQL function above via `db.execute(sql\`select
   find_agency_by_team_whatsapp_number(${fromPhone})\`)`).
2. If found: `resolveIdentity(agencyId, fromPhone)` runs exactly as Phase 2
   built it — unchanged.
3. If not found: the sender is `unknown` for every agency; there is no
   agency to scope the resulting `messages` row to using the existing
   agency-scoped schema (see the open question this raises below).

**Two follow-on implications to resolve during planning, not left implicit:**

1. **`team_members.whatsapp_number` has no global uniqueness constraint
   today** (only `(agency_id, email)` is unique — see
   `lib/db/schema/team-members.ts`). For `find_agency_by_team_whatsapp_number`
   to be deterministic, either add a partial unique index
   (`WHERE whatsapp_number IS NOT NULL`) so a phone number can only be
   registered to one team member across the whole platform, or
   explicitly decide and document what happens if two agencies' admins
   invite the same phone number (LIMIT 1 currently picks arbitrarily).
   Recommend the unique index — it matches the real-world invariant (one
   person, one agency) and turns a silent ambiguity into a constraint
   violation at invite time, which is the same "fail loud, not silent"
   posture the rest of this schema already follows (see the phone
   collision trigger in `0006_phase2_identity_rls.sql`).
2. **`authorized_contacts` has the identical structural issue in theory**
   (its uniqueness is `(agency_id, phone_number)`, not globally unique), but
   in production this shouldn't matter once WA-02 ships: client contacts
   message each agency's *own* number, so `phone_number_id` alone
   determines the agency (no cross-agency lookup needed for that number).
   The risk is specific to **this phase's testing**, where only the one
   shared test number exists — a test "client contact" scenario on the same
   test number faces the same chicken-and-egg problem team-member
   resolution does. **Recommendation:** for this phase's own verification
   script, only test the `client_contact` and `unknown` branches by first
   resolving via the team-member cross-agency function returning "no
   match," then defaulting to a single hardcoded test `agencyId` (matching
   how a real per-agency number would work once WA-02 exists) — document
   this explicitly as a test-harness simplification, not a production
   code path, so it isn't mistaken for the real WA-02 mechanism later.

**Confidence:** MEDIUM. The gap itself is HIGH confidence (verified directly
against the actual `resolveIdentity` signature and RLS policies in this
repo, plus `PROJECT.md`'s explicit WA-04 language). The specific SECURITY
DEFINER solution is [ASSUMED] — it follows the precedent 02-07-SUMMARY.md
already named as option (a) for the related SEG-12 gap, but has not been
implemented or tested in this codebase; treat it as a strong starting point
for planning, not a locked design.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `inngest` | `4.20.0` [VERIFIED: npm registry, 2026-09-10] | Async job orchestration for the outbound-send step | Already the project's chosen background-job engine (`STACK.md`); this phase is the first real integration point, and Phase 4's LLM calls will need durable retry/step semantics regardless — install now rather than retrofitting under a bigger, riskier Phase 4 refactor |
| `@neondatabase/serverless` + `drizzle-orm/neon-serverless` | already in repo | Transaction-scoped writes for the new `messages` table and the identity-resolution GUC pattern | Same driver `withTenantContext`/`withResolvedIdentityContext` already use — no new dependency |
| Node `crypto` (built-in) | Node 20+ (repo's `@types/node ^20`) | HMAC-SHA256 verification of `X-Hub-Signature-256` | No dependency needed — `createHmac`/`timingSafeEqual` are built-in and this is exactly the pattern the existing Clerk webhook establishes (via `svix`, which wraps the same primitive) |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| none (native `fetch`) | Node 20+ built-in | Outbound Graph API calls (`POST /{phone_number_id}/messages`) | No WhatsApp SDK needed — the send call is one `fetch` with a JSON body and a Bearer header; adding an SDK (e.g. `whatsapp-cloud-api` npm packages) would be exactly the kind of unnecessary abstraction layer STACK-AGENT.md already argues against for the LLM layer, applied here too |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written TS types for the webhook payload, parsed post-signature-verification (matches the existing `JSON.parse(rawBody) as WebhookEvent` pattern in `verify-clerk-signature.ts`) | `zod` schema validation | The codebase has zero runtime-validation dependencies today and leans on TypeScript types + signature verification as the trust boundary. Meta's payload is more deeply optional/nested than Clerk's (text vs. image vs. audio vs. status, each a different shape under `value`), so `zod` genuinely reduces the chance of an unhandled-shape crash — but introduces the project's first schema-validation dependency. Flag for planner discretion; either is defensible, but if `zod` is introduced here it should be justified explicitly (not silently added) since it's a first-of-its-kind dependency for this codebase. |
| Inngest for the outbound-send async step | Vercel's `after()` / `waitUntil()` (no new dependency) | `after()` lets code keep running after the response is sent, within the function's max duration — no retry semantics, no dashboard, no durability if the process is killed mid-call. Reasonable for a true one-shot fire-and-forget, but Meta's send call can fail transiently (rate limit, timeout) and this phase's own goal (D-01) is to prove outbound sending is *reliable* before Phase 4 depends on it — Inngest's automatic retry is the actual value being tested, not just "don't block the response." |

**Installation:**
```bash
npm install inngest
```

**Version verification:** `npm view inngest version` → `4.20.0`, confirmed live against the npm registry on 2026-09-10. [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```
Meta Graph API (WhatsApp Cloud API)
        │
        │ GET  ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...  (one-time handshake)
        │ POST { entry[].changes[].value: { messages[] | statuses[] } }    (every inbound event)
        ▼
app/api/webhooks/meta/route.ts  (Next.js Route Handler, runtime="nodejs")
        │
        ├─ GET  → compare hub.verify_token, echo hub.challenge as plain text, 200
        │
        └─ POST → 1. read raw body (request.text()) — MUST happen before any parsing
                  2. verify X-Hub-Signature-256 (HMAC-SHA256 over raw bytes, timingSafeEqual)
                  3. JSON.parse the verified body
                  4. branch: value.statuses present? → ack 200, no-op (delivery/read receipts,
                     nothing to process this phase)
                  5. value.messages present? → for each message:
                     a. findAgencyByTeamWhatsAppNumber(from) → agencyId
                        (cross-agency lookup, see Critical Architecture Gap)
                     b. resolveIdentity(agencyId, from)              [Phase 2, reused as-is]
                     c. withResolvedIdentityContext(agencyId, identity, tx => {
                          INSERT INTO messages (...) ON CONFLICT (agency_id, meta_message_id)
                            DO NOTHING RETURNING id                   [idempotency gate]
                        })
                     d. if a row was actually inserted (not a duplicate delivery):
                          inngest.send({ name: "whatsapp/message.received", data: {...} })
                  6. return 200 "ok" — fast, regardless of async work outcome
        ▼
app/api/inngest/route.ts  (Inngest serve handler)
        │
        ▼
inngest function: "send-whatsapp-ack"
        │  triggered by "whatsapp/message.received"
        │  1. build fixed ack text ("Mensaje recibido" — no LLM, D-01)
        │  2. POST https://graph.facebook.com/v25.0/{PHONE_NUMBER_ID}/messages
        │       Authorization: Bearer META_WHATSAPP_ACCESS_TOKEN
        │       body: { messaging_product: "whatsapp", to: from, type: "text",
        │               text: { body: ackText } }
        │  3. withResolvedIdentityContext(...) → INSERT outbound row into `messages`
        │     (direction='outbound', same agencyId/identity as the inbound row)
        │  Inngest retries this step automatically on transient failure —
        │  this is the actual behavior D-01 exists to prove.
        ▼
Meta Graph API → delivers the ack to the sender's WhatsApp client
```

### Recommended Project Structure
```
app/
├── api/
│   ├── webhooks/
│   │   └── meta/
│   │       └── route.ts          # GET verification + POST event intake
│   └── inngest/
│       └── route.ts              # Inngest serve() handler
lib/
├── webhooks/
│   ├── verify-clerk-signature.ts  # existing
│   └── verify-meta-signature.ts   # new, same shape (HMAC-SHA256, raw body)
├── whatsapp/
│   ├── send-message.ts            # outbound Graph API call (POST /messages)
│   ├── parse-webhook-payload.ts   # typed parsing of value.messages / value.statuses
│   └── find-agency-by-whatsapp-number.ts   # cross-agency lookup wrapper (Critical Gap)
├── db/schema/
│   └── messages.ts                # new table, D-04
inngest/
├── client.ts                      # Inngest client instance
└── functions/
    └── send-whatsapp-ack.ts       # background function, D-01's outbound proof
drizzle/migrations/
└── 0012_messages_table.sql        # messages table + RLS + find_agency_by_team_whatsapp_number()
```

### Pattern 1: Raw-body-first webhook verification (mirrors existing Clerk pattern exactly)

**What:** Read the request body as text before any parsing, verify the
signature over those exact bytes, only then `JSON.parse`.
**When to use:** Every webhook endpoint in this codebase — this is already
an established, working pattern (`app/api/webhooks/clerk/route.ts`), not a
new one being introduced.
**Example:**
```typescript
// lib/webhooks/verify-meta-signature.ts — new file, same shape as
// lib/webhooks/verify-clerk-signature.ts
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

  // Buffers of different length would throw in timingSafeEqual — check first.
  if (
    expectedBuf.length !== providedBuf.length ||
    !timingSafeEqual(expectedBuf, providedBuf)
  ) {
    throw new MetaWebhookVerificationError("Signature mismatch.");
  }
}
```
[CITED: developers.facebook.com/docs/graph-api/webhooks/getting-started — signature verification requirements; timingSafeEqual pattern CITED against Node.js crypto docs conventions used identically by the existing Clerk/svix verification in this repo]

### Pattern 2: GET verification handshake

**What:** Meta sends one `GET` with `hub.mode`, `hub.verify_token`,
`hub.challenge` when the webhook URL is registered. The response body must
be the raw `hub.challenge` string, not JSON.
**Example:**
```typescript
// app/api/webhooks/meta/route.ts (partial — GET handler)
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    // Plain text, NOT Response.json() — a JSON-wrapped challenge fails
    // Meta's verification.
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}
```
[CITED: developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests]

### Pattern 3: Idempotent insert as the dedup mechanism (mirrors `createAgencyFromClerkOrg`)

**What:** Use Meta's message id (`messages[].id`, a "wamid...") as the
natural idempotency key. `INSERT ... ON CONFLICT DO NOTHING`, then only
proceed to the async outbound-send step if a row was actually inserted —
this is the exact pattern `lib/agencies/create-agency.ts` already
establishes for Clerk's at-least-once webhook delivery.
**When to use:** Any webhook provider with retry-on-non-200 semantics (Meta
retries with exponential backoff for up to 7 days, per official docs).
**Example:**
```typescript
const [inserted] = await tx
  .insert(messages)
  .values({ agencyId, metaMessageId, direction: "inbound", /* ...other fields */ })
  .onConflictDoNothing({ target: [messages.agencyId, messages.metaMessageId] })
  .returning({ id: messages.id });

if (!inserted) {
  // Duplicate delivery — already processed, skip the async send entirely.
  return;
}
await inngest.send({ name: "whatsapp/message.received", data: { messageRowId: inserted.id } });
```

### Anti-Patterns to Avoid

- **Calling `request.json()` before signature verification:** breaks the
  HMAC comparison the same way it would for Clerk — the codebase already has
  this lesson encoded in `verify-clerk-signature.ts`'s doc comment; apply it
  identically here.
- **Downloading media "just to check" during this phase:** D-05 explicitly
  scopes this phase to storing `media_id`/`mime_type` only. Calling
  `GET /{media_id}` even to inspect metadata issues a download-URL request
  that expires in 5 minutes and has no purpose here — don't call it at all.
- **Querying `team_members`/`authorized_contacts` directly inside a
  `withResolvedIdentityContext` scope for an `unknown` identity:** this is
  the exact pattern `02-07-SUMMARY.md`'s SEG-12 finding warns against. This
  phase's code must never do this — the resolved identity from
  `resolveIdentity` is already everything the message-persistence step
  needs; there is no reason to re-query either table after resolution.
- **Assuming the webhook only ever delivers `messages`:** the same
  subscription also delivers `statuses` (delivery/read receipts) for every
  outbound send. Code that assumes `value.messages` always exists will
  throw on a `statuses`-only payload.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HMAC-SHA256 signature comparison | A custom string-equality check | `crypto.timingSafeEqual` (built-in) | Timing attacks against `===` string comparison are a known, cheap class of exploit against webhook secrets — this is one `if`, not a library, but it must be the constant-time primitive, never `===` |
| Async job retry/backoff for the outbound send | A custom setTimeout-based retry loop | Inngest's built-in step retry | Exactly the kind of "you'd be paying for the framework's abstraction and still building the same plumbing yourself" tradeoff STACK-AGENT.md §2 already argues against for the agent loop — Inngest is already the chosen tool for this project, use its retry primitive rather than reimplementing exponential backoff |
| Webhook duplicate-delivery detection | An in-memory or Redis-based seen-id cache | Postgres `UNIQUE` index + `ON CONFLICT DO NOTHING` | The codebase already has a working, durable pattern for exactly this (`createAgencyFromClerkOrg`) — a cache adds a second source of truth and a TTL-tuning problem for no benefit when the database is already the durable store being written to anyway |
| Cross-agency phone number lookup | A raw bypass-role Postgres connection used ad hoc wherever needed | A single, narrow `SECURITY DEFINER` SQL function returning only `agency_id` | A general bypass connection is a much larger attack surface than one function with one auditable purpose and one returned column — see §Critical Architecture Gap |

**Key insight:** every "don't hand-roll" item in this phase has a direct
precedent already committed in this repo (Clerk webhook idempotency, the
`with-tenant-context.ts` GUC pattern, STACK-AGENT.md's anti-framework
stance) — this phase's job is to extend those exact patterns to a second
webhook provider, not invent new ones.

## Common Pitfalls

### Pitfall 1: GET handshake response must be the raw challenge string
**What goes wrong:** Returning `Response.json({ challenge })` or any
wrapper instead of the bare string causes Meta to reject the webhook
registration outright — described in multiple independent sources as the
single most common integration failure.
**Why it happens:** Every other API convention in this codebase returns
JSON; it's an easy, unconsidered default to reach for here too.
**How to avoid:** `new Response(challenge, { status: 200 })` — no JSON
wrapper, no headers override needed.
**Warning signs:** Meta's dashboard "Verify and Save" button fails
immediately when clicked. [CITED: multiple corroborating sources —
webhookrelay.com, hookdeck.com, n8n community threads reporting the same
failure mode]

### Pitfall 2: The WABA-to-app webhook subscription is a separate step from the dashboard toggle
**What goes wrong:** Toggling "Subscribe" for the `messages` field in the
App Dashboard's Webhooks tab does not always durably register the
WABA-to-App subscription in Meta's current UI — some integrators report the
dashboard toggle silently not persisting, especially with newer UI
layouts.
**Why it happens:** The subscription is actually a Graph API relationship
(`POST /{WABA_ID}/subscribed_apps`) that the dashboard is meant to manage on
your behalf, but the older UI did this automatically on phone number
add and the newer, more fragmented UI does not always do so reliably.
**How to avoid:** After configuring the webhook in the dashboard, explicitly
call `POST /{WABA_ID}/subscribed_apps` (with an access token that has
`whatsapp_business_management` permission) and confirm with `GET
/{WABA_ID}/subscribed_apps` that the app id is listed.
**Warning signs:** Signature verification code is correct, the GET handshake
succeeded, but no POST ever arrives when a real message is sent to the test
number. [MEDIUM confidence — WebSearch-sourced, corroborated by a Postman
collection documenting the same endpoint and by community reports, not
independently reproduced in this session]

### Pitfall 3: Test number is hard-capped to 5 manually-added recipients
**What goes wrong:** Attempting to send or receive from any phone number not
explicitly added to the test number's recipient list in the Meta dashboard
silently fails (or the outbound send returns an error).
**Why it happens:** Meta's free developer test number is designed for
integration testing only, not real traffic — this is by design, not a bug.
**How to avoid:** Before any end-to-end test, add every phone number that
will send/receive test messages (developer's own number, any teammate
testing team-member identity resolution, any number standing in for a
client contact) to the test number's recipient list in
developers.facebook.com → WhatsApp → API Setup → "To" field management.
**Warning signs:** Outbound send API call returns a 4xx with a message about
the recipient not being in the allowed list. [MEDIUM confidence —
WebSearch-sourced across multiple integration guides, consistent with
Meta's documented test-number behavior]

### Pitfall 4: Access token type — 24h temporary vs. long-lived System User token
**What goes wrong:** The default access token copy-pasted from the Meta
dashboard's "API Setup" quickstart page expires in 24 hours. A test
integration that works on day one and silently starts failing with 401s a
day later almost always means this.
**Why it happens:** The quickstart flow is optimized for a 5-minute demo,
not a running application.
**How to avoid:** Generate a System User with a long-lived access token via
Business Settings → Users → System Users, assign it the WABA asset with
`whatsapp_business_messaging` permission, and use that token in
`META_WHATSAPP_ACCESS_TOKEN` instead of the quickstart token.
**Warning signs:** Outbound sends work in initial testing, then start
returning 401 Unauthorized after ~24h with no code changes. [ASSUMED —
training-knowledge-based; not independently re-verified against current
Meta dashboard UI in this session, but consistent with long-standing Graph
API token behavior and worth explicit user confirmation before relying on
it for a persisted `.env` value]

### Pitfall 5: At-least-once delivery means every webhook handler path must be idempotent, not just the "happy path"
**What goes wrong:** Meta retries with exponential backoff for up to 7 days
on any non-200 response (including a 200 that arrives after Meta's own
timeout, or a dropped response due to a network blip) — so **the same
payload will be delivered more than once** under real-world conditions, not
just in theory.
**Why it happens:** Standard at-least-once webhook delivery semantics,
identical in kind (though not in exact retry schedule) to Clerk's own
Svix-based retries, which this codebase's `createAgencyFromClerkOrg` already
defends against.
**How to avoid:** §Architecture Patterns Pattern 3 — `ON CONFLICT DO NOTHING`
keyed on `(agencyId, metaMessageId)`, gate the async outbound-send dispatch
on whether the insert actually happened.
**Warning signs:** During manual testing, sending one message from a phone
results in two "Mensaje recibido" acks arriving back. [MEDIUM-HIGH
confidence — Meta's own webhook retry documentation confirms 7-day retry
window with backoff; corroborated by multiple independent integration
guides describing the same dedup requirement]

### Pitfall 6: Vercel serverless functions don't keep running after the response is sent, without an explicit mechanism
**What goes wrong:** A webhook handler that returns `200` and then
continues an `await`-less "fire and forget" call (e.g. an unawaited
`inngest.send(...)` or an unawaited `fetch` to Graph API) risks the function
being frozen/torn down before that call completes, especially on Vercel's
standard serverless runtime.
**Why it happens:** Serverless functions are not long-running processes —
once the response is returned, there's no guarantee of further CPU time
unless the platform is explicitly told to keep the invocation alive
(`waitUntil`/`after()`) or the work is handed off to a separately-invoked
service (Inngest, which is invoked via its own HTTP call to
`/api/inngest`, not by "staying alive" inside the webhook's own function).
**How to avoid:** `await inngest.send(...)` before returning the 200 — this
is fast (it's just an HTTP POST to Inngest's event ingest endpoint,
typically well under 100ms), not the actual slow work, which then runs in a
separate Inngest-invoked function. Do not rely on background execution
inside the webhook's own function for anything that must actually complete.
**Warning signs:** Intermittent, non-reproducible failures to send the ack
that don't show up in any error log (because the process was frozen before
it could log anything). [MEDIUM confidence — general Vercel serverless
behavior, ASSUMED to apply as described to this specific deployment target;
verify against the project's actual hosting config, which STACK.md should
confirm]

## Code Examples

### Outbound send (D-01's proof of end-to-end outbound)
```typescript
// lib/whatsapp/send-message.ts
import "server-only";

const GRAPH_API_VERSION = "v25.0"; // [VERIFIED: developers.facebook.com, 2026-09-10]

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
[CITED: developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages/ — endpoint, headers, body shape, verified 2026-09-10]

### Messages table schema (D-04)
```typescript
// lib/db/schema/messages.ts
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencies } from "./agencies";
import { clients } from "./clients";

/**
 * Raw inbound/outbound WhatsApp message log (D-04). Deliberately separate
 * from `audit_log` (Phase 2) — audit_log is reserved for agent actions and
 * decisions in later phases; this table is the message transcript itself.
 *
 * RLS follows audit_log's plain agency-scoped shape (0006's
 * audit_log_tenant_isolation), NOT the three-branch admin/member/
 * client_contact convention from 0007_client_contact_scope.sql — no UI in
 * this phase (or in Phase 4's bitácora, which is a separate view) reads this
 * table under a client_contact role, and the webhook's own write path can
 * legitimately have only app.agency_id set (unknown-identity branch of
 * withResolvedIdentityContext sets nothing beyond that GUC). A three-branch
 * policy here would need to handle a write-time GUC shape (agency_id only)
 * that the three-branch convention wasn't designed for on the write side.
 * Revisit if/when a client-portal view of message history is built.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: text("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    // Nullable: team-internal 1:1 conversations (WA-03) have no client.
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(),
    // Future-proofs for the web chat channel (SIS-01) without a schema
    // change — this phase only ever writes 'whatsapp'.
    channel: text("channel").notNull().default("whatsapp"),
    fromPhoneNumber: text("from_phone_number").notNull(),
    toPhoneNumber: text("to_phone_number").notNull(),
    // Meta's wamid — the idempotency key (Pattern 3). Nullable because a
    // send that fails before Meta assigns an id has no value yet, but the
    // unique index below only applies where it's present.
    metaMessageId: text("meta_message_id"),
    // Mirrors lib/identity/types.ts's ResolvedIdentity discriminant exactly
    // — 'team_member' | 'client_contact' | 'unknown' — not a re-invented enum.
    resolvedIdentityType: text("resolved_identity_type").notNull(),
    resolvedIdentityId: uuid("resolved_identity_id"),
    messageType: text("message_type").notNull(),
    textBody: text("text_body"),
    // D-05: reference only, never downloaded this phase.
    mediaId: text("media_id"),
    mediaMimeType: text("media_mime_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("messages_agency_id_meta_message_id_idx")
      .on(table.agencyId, table.metaMessageId)
      .where(sql`${table.metaMessageId} is not null`),
    check(
      "messages_direction_check",
      sql`${table.direction} in ('inbound', 'outbound')`,
    ),
    check(
      "messages_resolved_identity_type_check",
      sql`${table.resolvedIdentityType} in ('team_member', 'client_contact', 'unknown')`,
    ),
    check(
      "messages_message_type_check",
      sql`${table.messageType} in ('text', 'image', 'audio', 'unsupported')`,
    ),
  ],
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Conversation-based pricing (24h conversation windows billed as a unit) | Per-message pricing by category (Marketing/Utility/Authentication billed per delivered message; Service is free) | Effective July 1, 2025 [MEDIUM confidence, WebSearch] | Directly affects WA-07: this phase's fixed ack, sent as a free-form reply inside the 24h customer service window, is a **Service**-category message and is currently free — no cost-tracking UI is functionally required by this phase, but the `messages` schema should not block adding a `pricing_category`/`cost` column later for Phase 4+'s template-based proactive sends (COB-03, CAL-03), which ARE billed |
| Embedded Signup v2 (and v3) | Embedded Signup v4 | Hard deprecation October 15, 2026 [CITED: ppc.land, unifyport.ai, developers.facebook.com] | Not directly exercised this phase (WA-02 deferred per D-03), but any placeholder/config code touching Embedded Signup concepts must target v4 exclusively — there is no reason to write v2-shaped code at any point now |
| Older Meta Business Suite UI (auto-registered WABA→App webhook subscription on phone number add) | Newer, more fragmented dashboard UI (subscription can silently fail to persist) | Ongoing, no single dated cutover found | Explicit manual `POST /{WABA_ID}/subscribed_apps` call recommended regardless of what the dashboard appears to show (Pitfall 2) |
| Graph API v21.0 (referenced in some late-2025/early-2026 sources) | Graph API v25.0 | Confirmed current as of 2026-09-10 via official docs fetch | Use `v25.0` in all Graph API URLs written this phase; Meta's versioning allows older versions to keep working for a support window, but there's no reason to target anything but current |

**Deprecated/outdated:**
- Embedded Signup v2/v3 feature types (Coexistence onboarding,
  `only_waba_sharing`, `marketing_messages_lite`) — hard cutoff Oct 15, 2026.
  Not used this phase; noted so no future phase accidentally reaches for v2
  docs still floating around in search results and blog posts.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The SECURITY DEFINER function is the right mechanism for the cross-agency phone lookup (vs. a dedicated bypass-role connection or an application-level invariant) | Critical Architecture Gap | Low-medium — the underlying problem (agencyId unknown before lookup) is solidly verified; the specific fix is a design choice for the planner, other equally valid solutions exist (e.g. a maintained in-memory/edge-cached `phone → agency` map refreshed on team roster changes) |
| A2 | Long-lived tokens require a System User (not just "generate a longer token" from the quickstart UI) and this is still true in the current Meta dashboard | Common Pitfalls #4 | Low — if the current UI differs, the actual failure mode (401 after ~24h) is still the right thing to watch for and debug toward; only the exact remediation click-path might differ |
| A3 | Vercel serverless functions (or whatever the actual hosting target is) don't reliably continue unawaited work after response — assumed without re-confirming the project's specific hosting config in this session | Common Pitfalls #6 | Low — `await`ing `inngest.send()` before returning 200 is correct regardless of hosting target, so the recommended code pattern is safe even if this specific assumption about the failure mode is imprecise |
| A4 | `team_members.whatsapp_number` should get a new global partial-unique constraint as part of this phase's migration | Critical Architecture Gap, implication 1 | Medium — if the planner instead chooses "pick first match, document the ambiguity" instead of enforcing uniqueness, that's a legitimate but different design decision with different edge-case behavior; flag for explicit discussion rather than assuming the index is mandatory |

**If this table is empty:** N/A — see entries above.

## Open Questions (RESOLVED)

1. **RESOLVED — 03-01-PLAN.md DEC-A adopts a dedicated system-actor GUC path
   (`withSystemWebhookContext`), not `withResolvedIdentityContext`, for both
   inbound and outbound `messages` writes.** Original question: Should this
   phase's `messages` table writes happen through
   `withResolvedIdentityContext`, or a dedicated service-role write path?
   - What we know: `withResolvedIdentityContext` is designed exactly for
     non-Clerk, WhatsApp-sender-authenticated writes (per its own doc
     comment in `02-04-SUMMARY.md`), and its GUC contract (agency_id always,
     team_member_id/role or client_id depending on branch) is a natural fit
     for scoping the `messages` insert.
   - What's unclear: whether the *outbound* ack write (which isn't
     "sent by" the resolved identity, but "sent to" them, from the system
     itself) should reuse the same resolved-identity GUC context as the
     inbound write, or use a distinct system-actor context. Both are
     defensible; the choice affects how `messages.resolvedIdentityId` reads
     for outbound rows.
   - Recommendation: reuse the same context for both inbound and outbound
     rows within one logical exchange (simpler, and `direction` already
     disambiguates) — but confirm this doesn't conflict with how Phase 4's
     eventual audit-log writes expect to attribute agent-initiated outbound
     messages.

2. **RESOLVED — deferred to empirical observation in 03-08-PLAN.md Task 3,
   step 8, which explicitly instructs recording observed behavior against
   this question; treated as identical-to-production for planning purposes
   in the meantime.** Original question: Is the free developer test WABA
   subject to the same webhook retry/backoff behavior as a
   production-verified WABA?
   - What we know: retry behavior is documented generally for the platform.
   - What's unclear: whether test-mode WABAs have different (possibly more
     lenient, possibly more aggressive) retry/rate characteristics — not
     found in any source consulted this session.
   - Recommendation: treat retry behavior as identical to production during
     planning (safer assumption), and note during actual test-number
     verification (the `[BLOCKING]` human-action checkpoint pattern from
     Phase 1/2) whether observed behavior differs.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `inngest` (npm package) | Async outbound-send orchestration | ✗ (not yet installed) | 4.20.0 latest [VERIFIED: npm registry] | `npm install inngest` — no fallback needed, trivial install |
| Meta Developer App + test WABA + test phone number | Entire phase — webhook registration, signature verification, outbound send | Not verifiable from this sandboxed session — requires the user's Meta for Developers account | — | None; this is a `[BLOCKING]` human-action checkpoint like Phase 1/2's Neon/Clerk steps — must be set up from a session with real network access and the user's own Meta credentials |
| Public HTTPS URL for the webhook (ngrok or deployed environment) | Meta's webhook registration requires a reachable HTTPS endpoint; localhost is not acceptable to Meta | Not verifiable from this sandboxed session | — | `ngrok http 3000` (or equivalent), same pattern Phase 1's Clerk webhook testing already used per `01-fundaciones-cuenta-equipo-02-SUMMARY.md` |
| Neon Postgres (`DATABASE_URL`) | New migration (messages table + SECURITY DEFINER function), `withResolvedIdentityContext` writes | Variable per session — `STATE.md` notes this differs session to session; must be checked directly (`psql "$DATABASE_URL" -c "select 1"`), not assumed | — | None; matches the exact caveat already documented in `STATE.md` for Phase 2 |

**Missing dependencies with no fallback:**
- Meta Developer App / test WABA / test phone number setup — requires a
  human with a Meta account, cannot be provisioned from this session.
- Public HTTPS tunnel for local webhook testing — requires either ngrok (or
  equivalent) run by the user, or testing against an actually-deployed
  environment.

**Missing dependencies with fallback:**
- `inngest` — trivial `npm install`, no blocker.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None (project convention: hand-written `tsx` assertion scripts, no test runner — see `scripts/verify-identity-classification.ts`) |
| Config file | none — see Wave 0 |
| Quick run command | `npx tsx scripts/verify-whatsapp-webhook-parsing.ts` (new, sandbox-safe: signature verification + payload parsing, no network) |
| Full suite command | `npm run db:verify-whatsapp` (new, requires real Neon + real Meta test WABA — mirrors `db:verify-identity`'s shape) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WA-04/SEG-01 | Cross-agency phone lookup resolves the correct agency for a team member's WhatsApp number, and returns no match for an unregistered number | integration (real Neon) | `npx tsx scripts/verify-whatsapp-webhook.ts` | ❌ Wave 0 |
| D-01 (outbound proof) | A real inbound test message triggers a real outbound ack via Meta's Graph API | manual + integration | Manual: send a WhatsApp message to the test number from an added test recipient, confirm ack arrives. Automated portion: `npx tsx scripts/verify-whatsapp-send.ts` (mocks/asserts the request shape without a live Meta call) | ❌ Wave 0 |
| Signature verification | A tampered/missing `X-Hub-Signature-256` is rejected with 400 before any DB write | unit (no network) | `npx tsx scripts/verify-whatsapp-webhook-parsing.ts` | ❌ Wave 0 |
| D-04 idempotency | A duplicate `meta_message_id` delivery does not create a second `messages` row or trigger a second outbound send | integration (real Neon) | `npx tsx scripts/verify-whatsapp-webhook.ts` (same file as WA-04 case, different assertion) | ❌ Wave 0 |
| D-05 media detection | An image/audio webhook payload is stored with `media_id`/`mime_type` populated and `text_body` null, with no call to the media download endpoint | unit (no network, payload fixture) | `npx tsx scripts/verify-whatsapp-webhook-parsing.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx tsx scripts/verify-whatsapp-webhook-parsing.ts` (fast, no network)
- **Per wave merge:** `npm run db:verify-whatsapp` (requires real Neon + real Meta credentials — same `[BLOCKING]` checkpoint shape as `02-07`)
- **Phase gate:** Full suite green + a real manual end-to-end WhatsApp message/ack round-trip, confirmed by the user, before `/gsd-verify-work 3`

### Wave 0 Gaps
- [ ] `scripts/verify-whatsapp-webhook-parsing.ts` — signature verification (valid/invalid/missing header) + payload-shape parsing for text/image/audio/statuses, no network, covers D-05 and the signature pitfall
- [ ] `scripts/verify-whatsapp-webhook.ts` — real-Neon integration test: cross-agency lookup, idempotent insert, `withResolvedIdentityContext` scoping — covers WA-04 and D-04
- [ ] `scripts/verify-whatsapp-send.ts` — asserts the outbound request shape (headers, body) against a stubbed fetch, without requiring a live Meta call for every CI-style run
- [ ] `drizzle/migrations/0012_*.sql` — messages table + RLS policy + `find_agency_by_team_whatsapp_number` function, needed before any of the above integration tests can run
- [ ] `package.json` script: `db:verify-whatsapp` — wire the new integration script the same way `db:verify-identity` is wired

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | Partial | No end-user auth in this phase's own surface — the security boundary is the webhook signature (§Pattern 1), functionally equivalent to authenticating the caller as "really Meta" |
| V3 Session Management | No | Stateless webhook + stateless outbound send; no session concept in this phase |
| V4 Access Control | Yes | Enforced entirely via existing Phase 2 RLS + GUC machinery (`withResolvedIdentityContext`) — this phase must not introduce any new application-level filtering, consistent with the project's established "RLS is the only enforcement" invariant |
| V5 Input Validation | Yes | Webhook payload shape is attacker-influenced input (even post-signature-verification, a compromised Meta account or a bug in Meta's own systems could send malformed shapes) — hand-written TS types + defensive optional-chaining, or `zod`, per §Alternatives Considered |
| V6 Cryptography | Yes | HMAC-SHA256 via Node's built-in `crypto`, never a hand-rolled comparison — never store `META_APP_SECRET` anywhere but environment variables (matches `.env.example` convention already established) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Forged webhook payload (attacker POSTs directly to the endpoint claiming to be Meta) | Spoofing | X-Hub-Signature-256 HMAC verification, rejected before any DB write (§Pattern 1) |
| Timing attack against signature comparison | Information Disclosure | `crypto.timingSafeEqual`, never `===` or plain string compare (§Don't Hand-Roll) |
| Replay of a previously-valid webhook payload | Tampering / Repudiation | Idempotent insert keyed on `meta_message_id` prevents a replayed payload from re-triggering an outbound send or double-counting a message, even though Meta's signature would still validate (the signature proves origin, not freshness — Meta doesn't include a nonce/timestamp binding into the signature scheme the way Svix's `svix-timestamp` does) |
| Cross-agency data leak via the new SECURITY DEFINER function returning more than `agency_id` | Elevation of Privilege | The function must return exactly one scalar column (`agency_id`) and nothing else — reviewed explicitly in code review, same posture as the existing `agent_action_catalog`'s deliberate no-RLS design being called out in its own migration comment |
| `unknown`-resolved identity scope used to read `team_members`/`authorized_contacts` | Elevation of Privilege (SEG-12) | Never query those two tables inside a `withResolvedIdentityContext` scope for an `unknown` identity — the resolved identity already carries everything needed; this is a code-review-enforced invariant per `02-07-SUMMARY.md`, not (yet) an RLS-enforced one |

## Sources

### Primary (HIGH confidence)
- `developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages/` — endpoint URL, headers, request body shape, current Graph API version (v25.0), fetched 2026-09-10
- This repository: `app/api/webhooks/clerk/route.ts`, `lib/webhooks/verify-clerk-signature.ts`, `lib/agencies/create-agency.ts`, `lib/tenant/with-tenant-context.ts`, `lib/identity/resolve-identity.ts`, `lib/identity/types.ts`, `lib/db/schema/*.ts`, `drizzle/migrations/0001-0011*.sql` — verified directly by reading, not inferred
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and `03-api-reference/03-file-conventions/route.md` — confirms the existing Route Handler pattern (raw body via `request.text()`, `runtime = "nodejs"`, webhook example matching this repo's own Clerk handler) is current and unchanged for this Next.js version

### Secondary (MEDIUM confidence)
- `developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/*` and `ppc.land` / `unifyport.ai` — Embedded Signup v4 vs. v2 deprecation date (Oct 15, 2026), corroborates STACK-AGENT.md's existing claim
- Multiple WebSearch sources (webhookrelay.com, hookdeck.com, chatarmin.com, wetarseel.ai) — webhook verification handshake shape, X-Hub-Signature-256 verification steps, retry/idempotency behavior, rate limits (80 MPS standard), per-message pricing shift (July 2025) and free Service category (Nov 2024) — cross-referenced across 3+ independent sources each

### Tertiary (LOW confidence)
- WABA-to-App subscription registration failure mode in the "newer UI" (Pitfall 2) — single-thread-corroborated (Postman collection description + community reports), not independently reproduced
- Long-lived System User token requirement specifics (Pitfall 4) — training-knowledge-based, flagged `[ASSUMED]` in the Assumptions Log

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Inngest version verified live against npm registry; native `fetch`/`crypto` require no version verification
- Architecture (webhook shape, send endpoint, GUC/RLS integration): HIGH — implementation mechanics verified against official docs fetched this session and against this repo's own existing code
- Critical Architecture Gap (cross-agency resolution): MEDIUM — the gap itself is HIGH confidence (directly verified against actual code + PROJECT.md), the specific SECURITY DEFINER solution is MEDIUM/ASSUMED (sound precedent, not yet implemented or tested)
- Pitfalls: MEDIUM-HIGH — signature verification and idempotency pitfalls HIGH confidence (multiple corroborating sources + existing in-repo precedent); dashboard-subscription and token-lifetime pitfalls MEDIUM/LOW, flagged accordingly

**Research date:** 2026-09-10
**Valid until:** 30 days for the implementation-mechanics sections (Graph API version, send endpoint shape are stable, slow-moving); 7 days for the pricing/deprecation-date claims under §State of the Art, since Meta's WhatsApp platform pricing and deprecation timelines have moved multiple times within 2025-2026 and should be re-confirmed close to actual implementation
