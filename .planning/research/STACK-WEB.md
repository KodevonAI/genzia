# STACK-WEB.md — Genzia: Web/App Stack Recommendation

Grounded in `PROJECT.md`, `REQUIREMENTS.md` (esp. SEG-*), and `ROADMAP.md`.
Verified against current (Sept 2026) releases via web search. Prescriptive —
one recommendation per decision.

## 1. Web framework & app architecture

**Next.js 16 (latest stable, currently 16.3.x), App Router, TypeScript, React 19.**
Single full-stack repo, not a separate frontend+backend split.

Why: the primary interface is a streaming, multi-turn agent chat (web *and*
WhatsApp), not CRUD forms — exactly the case the Vercel AI SDK (`ai` v6) and
Next.js Route Handlers were built for: `streamText`/`useChat` give
token-level streaming with almost no plumbing, and the same server-side
agent-orchestration code can be invoked from a web chat route and from the
WhatsApp webhook handler. Next.js 16 is Active LTS (security support into Oct
2027); 15 is already maintenance-only. A split frontend/backend (React SPA +
separate Express/Nest API) buys nothing here — a second deploy target and
auth boundary for no isolation benefit, since real isolation happens at the
database layer regardless of how many app processes call it (§2). Keep Route
Handlers/Server Actions as thin controllers; put agent orchestration,
tenant-scoped data access, and risk classification in a shared `lib/` package
so both the web chat and WhatsApp webhook path call the identical,
already-scoped functions — never let the WhatsApp path grow its own
data-access code that could drift out of sync.

**Do not** reach for Remix or SvelteKit: neither has an equivalent to the AI
SDK's first-party Next.js integration, and mainstream/well-documented was an
explicit constraint here.

## 2. Database & multi-tenant data isolation — the critical decision

**PostgreSQL, with Row-Level Security (RLS) as the structural isolation
mechanism**, not application-layer scoping alone, and not schema-per-tenant or
database-per-tenant.

This is the one recommendation to get right, because SEG-05/06/07/08 demand
isolation at **two nested levels**: agency (tenant) and, inside each agency,
per-client (sub-tenant), plus a visible-to-client vs. internal-only split
*within* a client's own rows. Evaluated:

- **App-layer scoping only** (every query manually adds `WHERE agency_id = ?
  AND client_id = ?`) — rejected. This is "the agent is instructed not to,"
  not "the agent cannot": one missed clause in one query path (and an
  AI-written codebase will have many) leaks data — the exact failure SEG-05
  rules out.
- **Database-per-tenant / schema-per-tenant** — rejected. The isolation that
  matters most (client A vs. client B) is *inside* one agency tenant.
  Provisioning a database or schema per *client* would mean hundreds per
  active agency — an operational non-starter for a small team, and it still
  wouldn't express the visible/internal split within one client's rows.
- **Postgres RLS, keyed on `agency_id` and `client_id`** — recommended. RLS
  is enforced by Postgres itself on every statement, including raw SQL and
  any query path an AI-agent-written feature might add later — the only
  option that makes "the agent structurally cannot see client B's data" true
  at the storage layer, not the application layer. It also expresses the
  visible/internal split directly: a `visibility` column plus a second
  policy (or a stricter `client_portal` DB role) makes internal rows
  unreachable from the portal regardless of what the agent's prompt says.

**Mechanism, concretely**: every request (web or WhatsApp) resolves identity
first (SEG-01), then opens one Postgres transaction that runs
`SELECT set_config('app.agency_id', $1, true)` and, when scoped to one client,
`set_config('app.client_id', $2, true)` *before any other query* — enforced by
a single middleware wrapper the rest of the codebase cannot bypass. RLS
policies read these session GUCs via `current_setting()`. Connect through a
pooler in **transaction mode** (Neon and Supabase's PgBouncer both support it)
so each transaction gets a clean session. Write both `USING` and `WITH CHECK`
on every policy (skipping `WITH CHECK` lets a write leak a foreign
`client_id` even though reads are blocked), and run `ALTER TABLE ... FORCE
ROW LEVEL SECURITY`, since Postgres exempts table owners from their own RLS —
the app's DB role must not own the tables it's scoped against.

**ORM**: **Drizzle ORM**, not Prisma. Drizzle's SQL-first design keeps the
tenant-scoping transaction explicit and visible in the codebase — important
for both human review and an AI coding agent working correctly around it —
rather than hidden behind ORM middleware; Prisma's client-extension approach
to RLS works but adds indirection around the exact code path isolation
depends on. Drizzle Kit doesn't yet auto-generate RLS policies (open RFC) —
write and review them as explicit, hand-authored migrations.

**Hosting**: **Neon** for Postgres — serverless, scale-to-zero, and its
per-branch database branching is a real advantage for an AI-agent-driven small
team (every preview deploy/PR can get an isolated DB branch with the same RLS
policies to test isolation against, cheaply). Supabase is a reasonable
fallback if the team later wants bundled Storage/Realtime, but its always-on
compute pricing and bundled Auth (unused here — see §3) make it second choice.

## 3. Auth & permissions

**Clerk (Organizations)** for agency staff. An "Organization" in Clerk maps
directly to one agency tenant; Clerk's org roles map to admin/member (CTA-05).
Per-client assignment (CTA-06) is *not* an auth-provider concept — store it as
a `client_assignments` join table in Postgres, scoped by the same RLS as
everything else. On sign-in, Clerk's org ID becomes the `agency_id` claim that
seeds the session GUC from §2. Clerk beats WorkOS here because WorkOS's
strength (SSO/SCIM/directory sync for enterprise IT buyers) is irrelevant to a
self-serve-signup agency SaaS — that's paying for federation Genzia doesn't
need at this stage.

**Do not** use Clerk (or any hosted auth provider) for end clients (POR-*).
The authoritative record of who's allowed to act for a client is already the
`authorized_contacts` table required by SEG-02/03 — duplicating that into a
second identity system creates two sources of truth. Instead, give the client
portal a lightweight magic-link/OTP login (email or WhatsApp) issued against a
row in `authorized_contacts`, with your own short-lived signed session cookie
— keeping SEG-03 ("only the agency team adds/removes authorized contacts")
true by construction.

**Phone-number identity resolution for WhatsApp (SEG-01/02)** is not an auth
problem — it's a DB lookup at webhook-ingestion time, before the agent
generates anything: look up the sender's number against `team_members` (if on
the shared internal number) or `authorized_contacts` (if on the agency's
client-facing number), inside the same RLS-scoped transaction. Build this as
one small, well-tested resolver function — the literal enforcement point for
SEG-01/05/12, so it deserves one auditable code path, not logic spread across
handlers.

## 4. Background jobs / scheduling

**Inngest.** It fits payment due-date detection, recurring-billing checks,
reminder sends, and contract-renewal alerts as durable, retryable step
functions, and its multi-step model (steps as durable checkpoints) is also the
natural shape for the agent's own multi-step, tool-calling work (e.g., CON-03's
"regenerate on feedback, or hold for approval"). It needs no separate
always-on worker process — functions run inside the same Vercel deployment,
invoked via a webhook Inngest calls — which matters for a small team avoiding
extra infra to operate. Trigger.dev v3 is a reasonable alternative if
self-hosting becomes a requirement later, but Inngest's simpler zero-worker
Vercel integration is the better default now. **Do not** reach for raw
BullMQ/Redis — it requires and operates its own always-on worker + Redis
infrastructure, exactly the ops burden this team is trying to avoid.

## 5. File storage

**Cloudflare R2** (S3-compatible) for the assets library (SIS-04), contracts,
and portal file uploads (POR-04) — no egress fees matter once clients
repeatedly download their own video/photo assets, and the S3 API means any
standard SDK works.

For the **credentials vault (BOV-01)**, storage-level encryption isn't
enough — these are structured secrets (passwords, API keys), not opaque
files, and "visible only to team" must hold even against a DB dump. Encrypt
each credential field at the **application layer** (AES-256-GCM) before it
reaches Postgres, with the data key wrapped by a KMS (AWS or Google Cloud KMS
envelope encryption) rather than a hardcoded app secret, so a leaked database
backup alone can't read vault contents. This is in addition to, not instead
of, the RLS policy that already keeps the vault table out of client-facing
queries.

## 6. Hosting/infra

**Vercel** (Next.js app + Route Handlers + Inngest-invoked functions) +
**Neon** (Postgres) + **Cloudflare R2** (storage) + **Inngest Cloud** (jobs) +
**Clerk** (staff auth). Five managed services, zero servers to patch or scale
by hand — realistic for Kodevon's small team without a dedicated DevOps hire,
and it's the combination Next.js/Vercel/Neon/Inngest are each built to
integrate with directly (Vercel's marketplace has native Neon and Inngest
integrations).

**Data residency flag (open question, not assumed)**: none of the above
default to Colombian regions — Vercel and Neon offer US/EU/some LatAm-adjacent
(e.g. São Paulo) regions but not Colombia specifically. `PROJECT.md` already
flags Colombian corporate/legal structure as pending legal review for the
Meta Tech Provider question — fold this in: confirm whether Ley 1581/Habeas
Data imposes any in-country storage requirement (vs. just cross-border-transfer
safeguards) before committing to region choices. Do not assume either way.

## 7. Real-time chat UI

**Server-Sent Events via the Vercel AI SDK's `useChat` hook**, not WebSockets.
The agent chat is fundamentally one-directional token streaming (model →
client) with occasional structured events (approval-needed, tool-call status);
SSE over a Route Handler returning a `ReadableStream` covers this completely,
works natively on Vercel's serverless functions, and needs no separate
stateful connection server. `useChat` already handles message state,
streaming assembly, and loading/error states, directly covering
CAL-05/CLI-02-style "ask the agent" flows in the web app. Reserve WebSockets
for a genuine future need (e.g. live multi-user presence on one conversation)
— not needed for v1, and it would add a stateful-connection component to what
is otherwise an entirely stateless-request architecture.
