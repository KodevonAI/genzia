# Phase 2: Modelo de identidad y permisos - Research

**Researched:** 2026-09-08
**Domain:** Multi-tenant identity resolution + Postgres RLS access control (no new framework/library — extends Phase 1's Drizzle/Neon/RLS foundation)
**Confidence:** HIGH (architecture/patterns, grounded directly in existing shipped code) / MEDIUM (a few genuine design judgment calls flagged below, not fully specified by CONTEXT.md)

## Summary

Phase 2 adds no new stack — it is a pure extension of the RLS/GUC pattern Phase 1
already shipped and proved (`lib/tenant/with-tenant-context.ts`,
`drizzle/migrations/0001_rls_policies.sql`,
`scripts/verify-rls-isolation.ts`). The entire job is: (1) a new
`authorized_contacts` table + a global `agent_action_catalog` lookup table + an
`audit_log` schema-only table, all following the exact Drizzle/RLS conventions
already established; (2) a `resolveIdentity(agencyId, phoneNumber)` function that
performs the same kind of `(agency_id, X)` lookup `withTenantContext` already
does for Clerk users, but keyed by WhatsApp number against two tables instead of
one; and (3) a parallel, non-Clerk GUC-setting helper (`withResolvedIdentityContext`
or similar) that shares its `set_config` mechanics with `withTenantContext` so
existing RLS policies keep working unchanged.

The one real design gap this research surfaces: the existing RLS contract only
knows two identity shapes — Clerk-authenticated team member (`app.team_member_id`
/ `app.role` = admin|member) and "nothing set" (fail-closed, zero rows). A
client-authorized-contact identity is a **third shape** the current schema has no
GUC for. This phase must extend the GUC contract (a new `app.client_id` GUC and a
`role` value of `'client_contact'`) and add a matching RLS branch to `clients`
(and document the contract for every future client-scoped table, e.g. Phase 5's
CRM fields, Phase 6's calendar). This is the most architecturally significant
decision for the planner to lock down explicitly, because every later phase that
adds a client-scoped table must repeat this exact three-branch pattern
(admin / assigned-member / client_contact) or silently reintroduce the leak this
whole phase exists to prevent.

**Primary recommendation:** Extend, don't replace. Reuse
`with-tenant-context.ts`'s exact `set_config`-in-transaction mechanics for a new
`withResolvedIdentityContext` helper; reuse its `(agencyId, X)`-lookup-then-set-GUCs
two-step shape for `resolveIdentity`; reuse `0001_rls_policies.sql`'s
`current_setting(..., true)` fail-closed idiom and `NULLIF(..., '')::uuid` fix
(0002) for every new policy; reuse `scripts/verify-rls-isolation.ts`'s
plain-`tsx`-script-against-real-Neon pattern for the new identity-resolution test
suite — but split `resolveIdentity` into a pure classification core (no I/O,
sandbox-testable) plus a thin DB-orchestration shell (network-required,
local/CI-only), so D-07's "función pura testeable" is literally true for the part
that matters most.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Identity resolution (`resolveIdentity`) | API/Backend (`lib/`) | Database (RLS as backstop) | Pure server-side logic; no UI, no new endpoint (D-07) |
| GUC/session context for non-Clerk callers | API/Backend (`lib/tenant/`) | Database (RLS policies consume the GUCs) | Mirrors `withTenantContext`; sets `set_config` inside a Postgres transaction |
| Authorized-contacts data + opt-in flag | Database (Drizzle schema + RLS) | API/Backend (future server actions to manage the roster) | Multi-tenant table, same pattern as `team_members`/`clients` |
| Action-type risk catalog | Database (static lookup table) | — | Global, not tenant-scoped — no `agency_id`, no RLS (see Architecture Patterns) |
| Audit log schema | Database (Drizzle schema + RLS) | — | Schema-only this phase (D-01); tenant-isolated like every other table |
| Cross-client data isolation | Database (RLS `FORCE ROW LEVEL SECURITY`) | API/Backend (never trust app-layer filtering alone) | Established non-negotiable principle since Phase 1 — "aislamiento por diseño, no por filtro" (PROJECT.md) |

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEG-01 | Cada mensaje entrante se resuelve a una identidad: equipo, contacto autorizado, o desconocido | `resolveIdentity(agencyId, phoneNumber)` contract (D-07); lookup order team_members → authorized_contacts → unknown, see Architecture Patterns |
| SEG-02 | Un número de teléfono está vinculado a un único cliente | `uniqueIndex` on `(agencyId, phoneNumber)` in `authorized_contacts`, same idiom as `team_members_agency_id_email_idx` (D-08) |
| SEG-03 | Solo el equipo agrega/quita contactos autorizados — el cliente nunca se autoriza a sí mismo | RLS write policy on `authorized_contacts` gated to `role IN ('admin','member')`; `role = 'client_contact'` has no write policy match → fails closed |
| SEG-04 | Opt-in explícito exigido antes de mensajes proactivos | Schema fields `opt_in_confirmed`, `opt_in_confirmed_by`, `opt_in_confirmed_at` + CHECK constraint tying them together (D-03); enforcement logic is Phase 3+, schema only now |
| SEG-05 | El contexto de conversación determina el alcance de datos — nunca por filtro | GUC contract (`app.agency_id`/`app.team_member_id`/`app.role`/new `app.client_id`) is what RLS reads — no query in application code adds a manual `WHERE client_id = ...` filter |
| SEG-06 | Chat 1:1 con miembro de equipo respeta su rol (admin todo, miembro solo asignados) | Already implemented by `clients_select_by_role` (0001/0002 migrations) — Phase 2 reuses unchanged for the team-member resolution path |
| SEG-07 | Chat 1:1 con contacto de cliente limita al agente a ese único cliente | New `app.client_id` GUC + new RLS branch on `clients` (and future client-scoped tables) — see Architecture Patterns, "Third GUC branch" |
| SEG-08 | Ficha de cliente separa "visible-cliente" de "solo-equipo" | No CRM fields exist yet (`clients.ts` stub, Phase 5) — Phase 2 establishes the *mechanism*: `authorized_contacts` itself is the first "solo-equipo" resource, and its RLS never grants `role='client_contact'` read access (see Open Questions #1 for the exact policy shape recommendation) |
| SEG-09 | El agente siempre admite ser IA si se le pregunta directamente | Out of `resolveIdentity`'s scope — this is agent-response behavior (Phase 3+/4). Phase 2 only needs to *not block* this: no schema work required, noted for completeness |
| SEG-12 | Número no registrado → flujo de conversión, sin acceso a datos de cuenta | `resolveIdentity` returns `{ type: 'unknown' }`; no GUC beyond `app.agency_id` (if even that) gets set → existing fail-closed RLS default (proven by `verify-rls-isolation.ts` scenario (a)/(b)) already guarantees zero data access — no new RLS work needed for this case |

*(SEG-10, SEG-11 explicitly deferred to Phase 4 per 02-CONTEXT.md D-01 — only the static `risk_level` catalog and `audit_log` schema shell are in scope here.)*

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Fase 2 solo define el modelo de datos: catálogo estático de
  `risk_level` ('low'/'high') por tipo de acción, y el esquema de la tabla
  `audit_log` (sin lógica de negocio ni UI). El motor de clasificación
  funcional, la cola de aprobación y la UI de bitácora visible quedan para
  Fase 4.
- **D-02:** El catálogo de tipos de acción se siembra ahora con los ejemplos
  ya concretos de PROJECT.md: recordatorio de pago = bajo riesgo; reagendar
  cita, contenido nuevo hacia el cliente = alto riesgo. Fase 4 agrega más
  tipos según los necesite el agente.
- **D-03:** Confirmación de opt-in es manual por el equipo: al agregar un
  contacto autorizado, checkbox obligatorio "confirmo que este contacto dio
  consentimiento afirmativo para WhatsApp" (sin default marcado). Se guarda
  quién confirmó y cuándo. No se construye verificación activa vía WhatsApp
  — eso es Fase 3.
- **D-04:** El opt-in solo bloquea mensajes proactivos del agente. Si el
  contacto autorizado escribe primero, el agente responde normalmente dentro
  del alcance de ese cliente, tenga o no opt-in confirmado.
- **D-05:** Tabla nueva de contactos autorizados. Campos mínimos: nombre,
  teléfono (único, ver D-08), email, rol dentro del cliente, estado de
  opt-in, quién confirmó y cuándo.
- **D-06:** La resolución de identidad de un miembro de equipo por WhatsApp
  usa `team_members.whatsapp_number` — búsqueda por `(agencyId,
  whatsappNumber)`. No se limita a `clerkUserId`/sesión Clerk.
- **D-07:** El resolver se construye como función pura testeable —
  `resolveIdentity(agencyId, phoneNumber) -> { type, scope }` — con una
  suite de tests automatizados (mismo patrón que
  `scripts/verify-rls-isolation.ts`) cubriendo los 4 casos del criterio de
  Éxito del ROADMAP. Sin UI ni endpoint de prueba nuevo. `agencyId` se
  recibe como parámetro explícito del caller.
- **D-08:** Un número de teléfono vinculado a un segundo cliente se bloquea
  con error claro — constraint único a nivel de datos más un mensaje que
  indique a qué otro cliente ya pertenece ese número.

### Claude's Discretion

- Nombres exactos de tablas/columnas
- Forma exacta del tipo de retorno del resolver
- Estructura interna de la suite de tests

### Deferred Ideas (OUT OF SCOPE)

- Verificación activa de opt-in vía plantilla de WhatsApp (esperar respuesta
  afirmativa) — depende de canal real (Fase 3+)
- Motor de clasificación de riesgo funcional, cola de aprobación humana, UI
  de bitácora visible — Fase 4
- Reclasificación de riesgo tras un "near-miss" y umbrales de confianza
  (PITFALLS.md #1) — posible backlog v2

## Project Constraints (from CLAUDE.md / AGENTS.md)

- `AGENTS.md` mandates reading `node_modules/next/dist/docs/` before writing
  code, because this fork of Next.js has breaking changes vs. training data.
  **Applicability check for this phase:** Phase 2 adds no routes, no
  components, no middleware, no new Next.js APIs — it is pure `lib/`
  server-side logic and Drizzle migrations, using patterns (`"use server"`,
  `"server-only"`, Server Actions returning `{ ok, error }` unions) already
  established and unchanged from Phase 1. No Next.js-doc-specific research
  finding changes as a result; noted here so the planner doesn't skip the
  read requirement, just confirms it's a no-op for this phase's surface area.
- No project-specific coding-convention `SKILL.md` applies to backend/data
  modeling (checked `.claude/skills/`: `caveman`, `frontend-design`, `gsd`,
  `hyperframes` — none address Drizzle/RLS/backend patterns).

## Standard Stack

### Core

No new libraries. Verified current versions of what's already installed and
directly relevant (no upgrade needed):

| Library | Version (installed) | Verified current? | Purpose |
|---------|---------|---|---------|
| `drizzle-orm` | 0.45.2 | [VERIFIED: `npm view drizzle-orm version` → 0.45.2, matches installed] | Schema definitions, `check()`/`uniqueIndex()` constraints, transactions |
| `@neondatabase/serverless` | ^1.1.0 | [ASSUMED — not re-checked, no phase-relevant API surface changes] | Pool/transaction driver (`neon-serverless`) for `withResolvedIdentityContext` |
| `drizzle-kit` | ^0.31.10 | [ASSUMED] | Migration tooling (schema migrations only; RLS/GUC SQL stays hand-authored per existing `0001`/`0002`/`0004` precedent — drizzle-kit doesn't generate RLS, noted in that file's own header comment) |

### Supporting

Nothing new. This phase deliberately avoids introducing a phone-number
validation library (`libphonenumber-js` etc.) or a schema-validation library
(`zod`) — neither exists anywhere in the current codebase; `lib/team/invite-member.ts`
validates WhatsApp numbers with a hand-rolled regex
(`/^\+[1-9]\d{7,14}$/`, described in-line as "Light E.164-ish check... full
validation isn't critical here — Phase 3's Meta integration is where this
number is actually validated"). Recommend reusing the exact same regex (or
extracting it to a shared `lib/` constant) for `authorized_contacts.phoneNumber`
input validation, for consistency and because the same "full validation
deferred to Phase 3" reasoning applies identically here.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled regex phone validation (matches existing pattern) | `libphonenumber-js` | More correct E.164 parsing, but introduces a new dependency for a validation step the codebase has already explicitly deferred to Phase 3 twice; not worth the inconsistency for this phase |
| `tsx` standalone script for the resolver test suite (D-07 mandates this pattern) | Vitest/Jest | No test framework exists anywhere in the repo yet; introducing one is a larger decision than this phase's scope and would break the "mismo patrón que `scripts/verify-rls-isolation.ts`" instruction in D-07 |

**Installation:** None required — no new packages.

## Architecture Patterns

### System Architecture Diagram

```
Incoming message (simulated in Phase 2; real WhatsApp webhook in Phase 3)
        │
        │  { agencyId, phoneNumber }   (agencyId explicit param — D-07 note:
        │                                real number→agency mapping is Phase 3)
        ▼
┌────────────────────────────┐
│ resolveIdentity(agencyId,  │   1. BEGIN transaction
│   phoneNumber)             │   2. set_config('app.agency_id', agencyId, true)
│ (lib/identity/resolve.ts)  │   3. SELECT team_members WHERE agency_id=? AND
│                            │        whatsapp_number=?   (RLS: agency_id-only
│                            │        gate — same shape as team_members today)
│                            │   4. IF no match: SELECT authorized_contacts
│                            │        JOIN clients WHERE agency_id=? AND
│                            │        phone_number=?
│                            │   5. classifyIdentity(teamMemberRow,           │
│                            │        contactRow)  ◄── PURE, no I/O           │
│                            │   6. Return { type, scope }                    │
└──────────────┬─────────────┘
               │  { type: 'team_member' | 'client_contact' | 'unknown', scope }
               ▼
┌─────────────────────────────────────┐
│ withResolvedIdentityContext(         │  Same transaction (or a fresh one),
│   agencyId, identity, fn)            │  sets the REMAINING GUCs based on
│ (lib/tenant/with-resolved-identity-  │  identity.type:
│   context.ts — parallel to           │   - team_member → app.team_member_id,
│   with-tenant-context.ts)            │       app.role = identity.role
│                                       │   - client_contact → app.role =
│                                       │       'client_contact',
│                                       │       app.client_id = identity.clientId
│                                       │   - unknown → nothing further set
│                                       │       (fail-closed default applies)
└──────────────┬────────────────────────┘
               ▼
       Postgres RLS (FORCE ROW LEVEL SECURITY on every tenant table)
       reads these GUCs exactly like it already does for Clerk-authenticated
       requests via withTenantContext — no policy needs to know or care
       which helper set them.
```

### Recommended Project Structure

```
lib/
├── identity/
│   ├── resolve-identity.ts        # resolveIdentity() — DB orchestration (network-required)
│   ├── classify-identity.ts       # classifyIdentity() — pure, no I/O (sandbox-testable)
│   └── types.ts                   # ResolvedIdentity discriminated union
├── tenant/
│   ├── with-tenant-context.ts     # unchanged — Clerk-session path
│   └── with-resolved-identity-context.ts  # new — non-Clerk GUC-setting path
├── db/schema/
│   ├── authorized-contacts.ts     # new
│   ├── agent-action-catalog.ts    # new (global, no agency_id, no RLS)
│   └── audit-log.ts               # new (schema-only, D-01)
scripts/
└── verify-identity-resolution.ts  # new — same pattern as verify-rls-isolation.ts
drizzle/migrations/
├── 0005_authorized_contacts.sql       # table + unique index + RLS + opt-in CHECK
├── 0006_client_contact_rls_scope.sql  # extends clients_select_by_role with 3rd branch
├── 0007_agent_action_catalog.sql      # global table + seed rows (D-02)
└── 0008_audit_log.sql                 # schema-only table + tenant RLS
```

*(Exact file/migration numbering and names are Claude's Discretion per CONTEXT.md — shown here to make the dependency order between them concrete for planning, not as a mandate.)*

### Pattern 1: Bootstrap lookup before the GUC that would gate it exists

**What:** `withTenantContext` already solves this exact problem for Clerk users:
it sets `app.agency_id` *first*, then queries `team_members` (whose RLS policy
only checks `agency_id`, not `role`/`team_member_id`) to discover the role, and
only *then* sets `app.team_member_id`/`app.role`. `resolveIdentity` needs the
identical two-step shape, just keyed by phone number instead of `clerkUserId`,
and checking two tables (`team_members`, then `authorized_contacts`) instead of
one.
**When to use:** Any lookup that must happen *before* the very GUC that would
otherwise restrict it is known.
**Example:**
```typescript
// Source: lib/tenant/with-tenant-context.ts (existing, verified in repo)
return tenantDb.transaction(async (tx) => {
  await tx.execute(sql`SELECT set_config('app.agency_id', ${orgId}, true)`);

  const [member] = await tx
    .select({ id: teamMembers.id, role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.agencyId, orgId), eq(teamMembers.clerkUserId, userId)));

  if (member) {
    await tx.execute(sql`SELECT set_config('app.team_member_id', ${member.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.role', ${member.role}, true)`);
  }

  return fn(tx);
});
```
`resolveIdentity` extends this same shape: after the `team_members` lookup
misses, run the `authorized_contacts` lookup (also gated only by `agency_id`,
same reasoning) inside the same transaction before deciding the final identity.

### Pattern 2: Split pure classification from I/O orchestration

**What:** D-07 asks for a "función pura testeable." A function that queries
Postgres cannot literally be pure. Split it: `classifyIdentity(teamMemberRow |
null, contactRow | null) -> ResolvedIdentity` takes already-fetched rows and
returns the discriminated union with zero I/O — this part is 100% pure and
unit-testable with plain assertions, no database, no network. `resolveIdentity`
is the thin, network-dependent shell that fetches the rows and calls it.
**When to use:** Whenever "testable business logic" and "needs a DB lookup"
collide — always separate the decision from the fetch.
**Example:**
```typescript
// New code — no existing precedent in repo, but same spirit as
// lib/team/current-member.ts separating assertion helpers from tenant-context
// plumbing.
export type ResolvedIdentity =
  | { type: "team_member"; teamMemberId: string; role: "admin" | "member" }
  | { type: "client_contact"; contactId: string; clientId: string; optInConfirmed: boolean }
  | { type: "unknown" };

export function classifyIdentity(
  teamMemberRow: { id: string; role: string } | null,
  contactRow: { id: string; clientId: string; optInConfirmed: boolean } | null,
): ResolvedIdentity {
  if (teamMemberRow) {
    return { type: "team_member", teamMemberId: teamMemberRow.id, role: teamMemberRow.role as "admin" | "member" };
  }
  if (contactRow) {
    return { type: "client_contact", contactId: contactRow.id, clientId: contactRow.clientId, optInConfirmed: contactRow.optInConfirmed };
  }
  return { type: "unknown" };
}
```

### Pattern 3: Third GUC branch for client-contact scope (new — no existing precedent)

**What:** `clients_select_by_role` (0001, fixed in 0002) currently has exactly
two branches: `role = 'admin'` (sees everything in the agency) or
`id IN (SELECT client_id FROM client_assignments WHERE team_member_id = ...)`
(assigned member). A resolved `client_contact` identity fits neither — it must
see exactly one client, without being a `team_members` row at all. Add a third
branch using a new GUC, `app.client_id`, and a new `role` value,
`'client_contact'`:
```sql
-- Illustrative — exact migration authored by planner/execution, following
-- the NULLIF(...,'') fix from 0002_fix_clients_rls_uuid_cast.sql for the
-- same "placeholder reset returns '' not NULL" reason documented there.
DROP POLICY clients_select_by_role ON clients;
CREATE POLICY clients_select_by_role ON clients
  FOR SELECT
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND (
      current_setting('app.role', true) = 'admin'
      OR id IN (
        SELECT client_id FROM client_assignments
        WHERE team_member_id = NULLIF(current_setting('app.team_member_id', true), '')::uuid
      )
      OR (
        current_setting('app.role', true) = 'client_contact'
        AND id = NULLIF(current_setting('app.client_id', true), '')::uuid
      )
    )
  );
```
**When to use:** This exact three-branch shape (admin / assigned-member /
client_contact) is the contract every future client-scoped table (Phase 5 CRM
fields, Phase 6 calendar, Phase 7 content, etc.) must repeat. Document this
explicitly as a named convention in code comments (the existing codebase's
style of "why," not just "what," per the comments already in
`with-tenant-context.ts` and the migration files) so it isn't reinvented or
forgotten per-phase.
**Note on `team_members`/`authorized_contacts` write policies:** these do NOT
need a `client_contact` branch — a client contact identity should never write
to either table. The absence of a matching policy branch is itself the
enforcement (fail-closed).

### Anti-Patterns to Avoid

- **Filtering client scope in application code instead of RLS:** PROJECT.md
  is explicit — "aislamiento por diseño, no por filtro." Do not write
  `WHERE clientId = resolvedIdentity.clientId` in a query and rely on that
  alone; the GUC + RLS policy must be the actual enforcement, with the query
  filter (if present) as redundant defense-in-depth at most.
- **Trusting `current_setting(..., true)` without `NULLIF(..., '')` before a
  `::uuid` cast:** 0002's fix is required knowledge for every new
  `uuid`-typed GUC comparison (`app.client_id` included) — a reset-to-empty-string
  GUC on a reused pooled connection will crash the query with `invalid
  input syntax for type uuid: ""` instead of failing closed, unless this
  idiom is followed everywhere.
- **Making `authorized_contacts` or the action-type catalog conditionally
  readable by `role = 'client_contact'`:** this is the concrete mechanism
  behind SEG-08 for this phase (see Open Questions #1) — a client contact
  must never be able to read the roster of *other* authorized contacts for
  its own client, let alone any other client's.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-tenant / cross-client data isolation | A manual `if` check in each server action that filters results by resolved scope | Postgres RLS (`FORCE ROW LEVEL SECURITY` + GUC-keyed policies), exactly as Phase 1 already established | Proven single point of enforcement; a missed `if` in new code is a silent leak, a missing GUC is a proven-fail-closed zero rows (see 0002's own war story) |
| Phone number format validation | A new regex or a new `libphonenumber-js` dependency | The existing `WHATSAPP_RE`-equivalent pattern from `lib/team/invite-member.ts` (or extract it to a shared constant) | Consistency; the codebase has already explicitly deferred full E.164 validation to Phase 3 twice — repeating that call here, not inventing a third validation strategy |
| Cross-table referential consistency (e.g., ensuring an `authorized_contacts.clientId` and its `agencyId` actually belong to the same agency) | Trusting the two separate foreign keys alone | A `BEFORE INSERT OR UPDATE` trigger, same shape as `client_assignments_agency_consistency` (migration 0004) | RLS's `WITH CHECK` only verifies the caller's own `agency_id` matches the written row — it does NOT verify that `clientId` and `agencyId` are mutually consistent with each other, exactly the gap 0004's comment documents |

**Key insight:** every "don't hand-roll" item here already has a working,
committed precedent in this exact codebase from Phase 1. This phase's job is
disciplined repetition of those patterns for two new identity shapes, not
invention of new mechanisms.

## Common Pitfalls

### Pitfall 1: A phone number registered as both a team member and a client contact

**What goes wrong:** `team_members.whatsapp_number` and
`authorized_contacts.phone_number` are separate columns in separate tables
with separate unique constraints. Nothing currently stops the same phone
number from being inserted into both — `resolveIdentity`'s lookup order
(team_members checked first) would then silently and permanently resolve
that number as a team member, never as a client contact, with no error
raised anywhere.
**Why it happens:** SEG-02's uniqueness guarantee ("un número solo puede estar
vinculado a un único cliente," D-08) is scoped to `authorized_contacts` only —
it says nothing about collision with `team_members`.
**How to avoid:** Add an explicit cross-table check before insert into either
table (application-level, since Postgres `CHECK` constraints cannot query
another table — same limitation `client_assignments_agency_consistency`
already works around with a trigger). A `BEFORE INSERT/UPDATE` trigger
function that queries the *other* table and raises on collision is the most
robust option, following the exact 0004 precedent.
**Warning signs:** A WhatsApp number that behaves inconsistently in tests
(sometimes team, sometimes client) — add this exact collision as a 5th case
in the identity-resolution test suite, alongside the ROADMAP's 4 required
cases.

### Pitfall 2: Reused pooled connection returns `''` instead of `NULL` for a never-reset custom GUC

**What goes wrong:** Exactly the bug 0002 already found and fixed for
`app.team_member_id` — the *first* time a custom GUC is set on a physical
backend connection, an unset read returns `NULL` (fail-closed, correct); on
a *later* reuse of that same pooled connection, a transaction-local reset
returns `''` (empty string), not `NULL`. Any `::uuid` cast on that raw value
crashes instead of failing closed.
**Why it happens:** Neon's pooler + `set_config(..., true)` transaction-local
semantics; documented in-line in `0002_fix_clients_rls_uuid_cast.sql`.
**How to avoid:** Every new GUC introduced this phase that gets `::uuid`-cast
in a policy (`app.client_id` is the one this phase adds) MUST use
`NULLIF(current_setting(...), '')::uuid`, never a bare cast. Apply this from
the first migration, not as a follow-up fix.
**Warning signs:** `invalid input syntax for type uuid: ""` in a Postgres
error log or a failed isolation-test assertion that should have been "zero
rows," not a crash.

### Pitfall 3: WhatsApp opt-in checkbox satisfies the schema but not Meta's actual policy (PITFALLS.md #2)

**What goes wrong:** D-03's manual checkbox is a real UX/compliance
improvement over "just add the number," but it is still the agency's own
unverified claim, not Meta's required affirmative WhatsApp-aware opt-in
captured at the moment of consent. PITFALLS.md #2 already documents this gap
and it is explicitly deferred (not solved) by CONTEXT.md's D-03/D-04.
**Why it happens:** Real verification requires a live WhatsApp template
round-trip, which requires Phase 3's channel to exist.
**How to avoid (for this phase):** Nothing to fix now — but do NOT let the
schema imply more certainty than it has. Recommend naming the column
`opt_in_confirmed_by_team` (or a code comment to the same effect) rather than
just `opt_in_confirmed`, so Phase 3/4 code reading this flag doesn't
mistake it for a Meta-verified opt-in.
**Warning signs:** None yet (this is a documentation/naming precaution, not
a bug) — but flag for Phase 3 planning when real WhatsApp sending exists.

### Pitfall 4: SEG-10/SEG-11's dual listing in ROADMAP.md (Phase 2 AND Phase 4)

**What goes wrong:** ROADMAP.md lists SEG-10/SEG-11 under both Phase 2 and
Phase 4's success criteria language, but the phase requirement IDs passed to
this research explicitly exclude their functional half from Phase 2 (only
the static catalog + `audit_log` schema shell are in scope, per D-01). A
planner working from ROADMAP.md alone (without reading 02-CONTEXT.md) could
over-scope Phase 2 to include the risk engine or approval queue.
**Why it happens:** ROADMAP.md predates the CONTEXT.md discussion that
resolved this ambiguity.
**How to avoid:** Treat 02-CONTEXT.md's D-01 as authoritative over
ROADMAP.md's phrasing — already reflected in this research's Phase
Requirements table (SEG-10/SEG-11 are absent from it, by design).
**Warning signs:** A plan task that mentions "approval queue" or "risk
classification logic" (as opposed to "risk_level catalog data") in Phase 2.

## Code Examples

### Existing GUC-setting transaction (the pattern to mirror)
```typescript
// Source: lib/tenant/with-tenant-context.ts (verified in repo, Phase 1)
export async function withTenantContext<T>(
  fn: (tx: Parameters<Parameters<typeof tenantDb.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) throw new NoTenantContextError();

  return tenantDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.agency_id', ${orgId}, true)`);
    const [member] = await tx
      .select({ id: teamMembers.id, role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.agencyId, orgId), eq(teamMembers.clerkUserId, userId)));
    if (member) {
      await tx.execute(sql`SELECT set_config('app.team_member_id', ${member.id}, true)`);
      await tx.execute(sql`SELECT set_config('app.role', ${member.role}, true)`);
    }
    return fn(tx);
  });
}
```

### Existing unique-index idiom (reuse for D-08's phone-uniqueness constraint)
```typescript
// Source: lib/db/schema/team-members.ts (verified in repo, Phase 1)
uniqueIndex("team_members_agency_id_email_idx").on(table.agencyId, table.email),
```

### Existing check() idiom (reuse for risk_level / opt-in-consistency constraints)
```typescript
// Source: lib/db/schema/team-members.ts (verified in repo, Phase 1)
check("team_members_role_check", sql`${table.role} in ('admin', 'member')`),
```

### Existing cross-table consistency trigger (reuse shape for authorized_contacts)
```sql
-- Source: drizzle/migrations/0004_client_assignments_check.sql (verified in repo)
CREATE OR REPLACE FUNCTION client_assignments_agency_consistency()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM clients
    WHERE clients.id = NEW.client_id AND clients.agency_id = NEW.agency_id
  ) THEN
    RAISE EXCEPTION
      'client_assignments.agency_id (%) does not match clients.agency_id for client_id %',
      NEW.agency_id, NEW.client_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

## State of the Art

No external ecosystem shifted here — this section is about *this codebase's*
own evolution, which is the relevant "state of the art" for a phase this
tightly coupled to Phase 1's shipped code.

| Old Approach (Phase 1, session-local assumption) | Current Approach (0002 fix) | When Changed | Impact |
|--------------------------------------------------|------------------------------|---------------|--------|
| `current_setting('app.team_member_id', true)::uuid` — bare cast | `NULLIF(current_setting(...), ''), '')::uuid` | Migration 0002 (Phase 1) | Every new `uuid`-typed GUC this phase introduces (`app.client_id`) must use the fixed idiom from day one, not the original bare-cast version |

**Deprecated/outdated:** N/A — no library deprecations relevant to this phase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `authorized_contacts` write access (INSERT/UPDATE/DELETE) should extend to assigned `member` role, not just `admin` (unlike `clients_write_admin_only`, which is admin-only) | Open Questions #1 / Architecture Patterns | If wrong (should be admin-only like client creation), the RLS write policy needs one fewer branch — low risk, easy to tighten later, but changes who can operate SEG-04's opt-in workflow day one |
| A2 | `authorized_contacts` SELECT should be agency_id-gated only (mirroring `team_members`'s current bare-agency_id policy), with finer role-based read restriction left to the application layer, rather than a role-gated RLS SELECT policy | Pattern 3 / Pitfall discussion | If wrong, a `member` role (or a bug reusing an agency-id-only transaction) could read authorized-contact PII for clients they aren't assigned to — should be validated against SEG-03/SEG-08 intent with the user before locking the migration |
| A3 | `agent_action_catalog` needs no `agency_id` column and no RLS (global, platform-wide catalog, not tenant data) | Standard Stack / Architecture Patterns | If wrong (e.g., agencies eventually need to customize their own risk classifications), this becomes a breaking schema change in Phase 4 rather than an additive one |
| A4 | `audit_log`'s schema-only shape (agencyId, clientId nullable, actionTypeCode FK, riskLevel snapshot, summary, createdAt) is sufficient scaffolding for Phase 4 to build on without a breaking schema change | Architecture Patterns | If Phase 4's actual logging needs (e.g., structured payload, channel, message linkage) don't fit this shape, Phase 4 pays a migration cost Phase 2 could have avoided by asking now |

**If this table is empty:** N/A — see rows above; all four should be
confirmed with the user or explicitly accepted as planner discretion before
the corresponding migrations are written.

## Open Questions (RESOLVED — see 02-CONTEXT.md D-09/D-10 and 02-PLAN files)

1. **(RESOLVED — option (b), via migration 0006/0007, plan 02-03)** What
   exactly does SEG-08 require from Phase 2, given `clients.ts` is
   still a deliberate stub?
   - What we know: PROJECT.md's visible/team-only layer distinction applies
     to CRM fields that don't exist until Phase 5. 02-CONTEXT.md's Phase
     Boundary doesn't mention SEG-08 at all in its decisions, yet SEG-08 is
     listed among this phase's required IDs.
   - What's unclear: whether "in scope for Phase 2" means (a) nothing
     concrete is buildable yet and SEG-08 is satisfied by a documented
     convention only, or (b) the planner is expected to invent some minimal
     concrete visible/team-only split now (e.g., treat `authorized_contacts`
     itself as the first "solo-equipo" table, per Pattern 3's anti-pattern
     note).
   - Recommendation: adopt (b) minimally — `authorized_contacts` RLS must
     never grant `role='client_contact'` read access (already the natural
     result of the fail-closed default, since no such policy branch exists)
     — and document this as the SEG-08 precedent Phase 5 must extend. Flag
     for the planner to confirm this framing satisfies the requirement's
     intent, since 02-CONTEXT.md doesn't discuss it explicitly.

2. **(RESOLVED — admin-only, per 02-CONTEXT.md D-10, implemented in
   plans 02-03/02-05)** Should `authorized_contacts` write access be
   admin-only or admin+assigned-member?
   - What we know: SEG-03 says "solo el equipo" (team, undifferentiated).
     The existing `clients_write_admin_only` policy is deliberately
     admin-only for creating clients themselves, with an explicit code
     comment that this narrows "as CRM permissions grow" in Phase 5.
   - What's unclear: whether managing an *existing* client's contact roster
     (a narrower, per-client action) should follow the same admin-only
     restriction, or the broader assigned-member pattern that
     `client_assignments`-adjacent actions already use (see
     `assignClient`/`removeClient` requiring admin only — actually also
     admin-only per `assertCallerIsAdmin` in `lib/clients/assign-client.ts`).
   - Recommendation: default to admin-only for v1 (A1 in Assumptions Log,
     but corrected toward consistency — the existing codebase's actual
     precedent for *every* mutation on `clients`-adjacent tables so far is
     admin-only, not admin+member). Confirm with the user during planning if
     this feels too restrictive for day-to-day contact management.

3. **(RESOLVED — `neon-serverless`, zero `neon-http` usage, implemented in
   `with-resolved-identity-context.ts`, plan 02-04)** Does the
   `resolveIdentity` transaction need to run inside `tenantDb` (the
   `neon-serverless` persistent-connection driver), same as
   `withTenantContext`, or can it use the stateless `neon-http` driver?**
   - What we know: `withResolvedIdentityContext` needs the same
     lookup-then-set-more-GUCs imperative multi-step transaction shape as
     `withTenantContext`, which specifically requires `neon-serverless`
     because `neon-http`'s `.transaction()` throws.
   - What's unclear: nothing, really — this is effectively answered by the
     existing code's own documented reasoning, restated here so the planner
     doesn't accidentally reach for the `db` export from `lib/db/index.ts`
     (the `neon-http`, unscoped one) for this new helper.
   - Recommendation: use `neon-serverless` via the same `tenantDb`-style
     `Pool`/`drizzle()` setup as `with-tenant-context.ts`, possibly sharing
     the same `Pool` instance if that's a well-understood pattern to Drizzle
     (module-level singleton, same as today) rather than opening a second
     pool.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Neon Postgres (network egress) | `authorized_contacts`/`agent_action_catalog`/`audit_log` migrations; `scripts/verify-identity-resolution.ts` integration run | ✗ (sandboxed session — see STATE.md, same gate as every Phase 1 plan) | — | Defer DB-touching verification to local machine / CI, exactly as Phase 1's plans did; the pure `classifyIdentity` unit tests (Pattern 2) CAN run in-sandbox since they require no network |
| `npm` / `npx tsx` | Running the new verification script locally | ✓ (verified: `npm view drizzle-orm version` succeeded in this session) | npm functional | — |

**Missing dependencies with no fallback:**
- None — the only blocker (Neon network egress) has a documented fallback
  (defer to local/CI), matching established project precedent.

**Missing dependencies with fallback:**
- Neon Postgres access — full integration verification (real GUC/RLS
  behavior against real Neon) deferred to local/CI; the pure classification
  logic can and should still be unit-tested in-sandbox during execution.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None installed — project convention is a standalone `tsx` script with a hand-rolled `check()`/`assertRowCount()` helper (see `scripts/verify-rls-isolation.ts`), not Vitest/Jest. D-07 explicitly mandates following this same pattern. |
| Config file | none — see Wave 0 |
| Quick run command | `npx tsx scripts/verify-identity-classification.ts` (pure `classifyIdentity` cases — no network, sandbox-safe) |
| Full suite command | `npx tsx scripts/verify-identity-resolution.ts` (real Neon integration — team/clientA/clientB/unknown + Pitfall 1's collision case; local/CI only) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEG-01 | Resolve team number, client A number, client B number, unknown number (ROADMAP success criterion) | integration | `npx tsx scripts/verify-identity-resolution.ts` | ❌ Wave 0 |
| SEG-01 (pure core) | `classifyIdentity` returns correct discriminated union for given row shapes | unit (no DB) | `npx tsx scripts/verify-identity-classification.ts` | ❌ Wave 0 |
| SEG-02 | Second insert of same phone number to a different client raises a clear DB error | integration | same `verify-identity-resolution.ts` (add an assertion) or a dedicated `verify-authorized-contacts-constraints.ts` | ❌ Wave 0 |
| SEG-03 | Write to `authorized_contacts` fails when GUC role is `client_contact` or unset | integration | same script, add assertion mirroring `verify-rls-isolation.ts`'s `(a)`/`(b)` no-context scenarios | ❌ Wave 0 |
| SEG-04 | Inserting `opt_in_confirmed = true` without `opt_in_confirmed_by`/`opt_in_confirmed_at` violates a CHECK constraint | integration (DB constraint) | same script or a lightweight `verify-authorized-contacts-constraints.ts` | ❌ Wave 0 |
| SEG-07 | `client_contact` GUC scope sees exactly its own client via `clients` RLS, never another client | integration | same `verify-identity-resolution.ts`, extending `verify-rls-isolation.ts`'s cross-agency-isolation style assertions to cross-client isolation for the new branch | ❌ Wave 0 |
| SEG-12 | Unknown number gets zero rows from any tenant table (no GUC beyond `app.agency_id`, if even that, is ever set) | integration | same script, reusing `verify-rls-isolation.ts` scenario (a)/(b) style assertions | ❌ Wave 0 |
| Pitfall 1 | Same phone number cannot be both `team_members.whatsapp_number` and `authorized_contacts.phone_number` | integration | same script | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx tsx scripts/verify-identity-classification.ts` (fast, no network, safe to run every commit including in this sandbox)
- **Per wave merge:** `npx tsx scripts/verify-identity-resolution.ts` (full suite, requires local/CI Neon access — matches Phase 1's plans' established pattern of deferring DB verification)
- **Phase gate:** Full suite green (from local/CI, not sandbox) before `/gsd-verify-work`, exactly as Phase 1's 01-03/01-04 plans required real end-to-end verification before being marked complete

### Wave 0 Gaps

- [ ] `scripts/verify-identity-classification.ts` — pure `classifyIdentity` unit cases (network-free)
- [ ] `scripts/verify-identity-resolution.ts` — full integration suite covering the ROADMAP's 4 required cases + SEG-02/03/04/07/12 + Pitfall 1's collision case
- [ ] No framework install needed — `tsx` is already a devDependency

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Partial — WhatsApp sender identity in v1 is trusted at the channel level (Meta-attested sender number via the Tech Provider integration, WA-01); this phase adds no additional verification of "is this really that phone's owner" beyond what Meta's API asserts. Treat this as an accepted v1 risk (see Known Threat Patterns) rather than a gap this phase should try to close. | N/A — out of scope, channel-level trust |
| V3 Session Management | No — no session concept for WhatsApp/client-contact identities (stateless per-message resolution, by design, per PROJECT.md's "resuelto antes de generar cualquier respuesta") | N/A |
| V4 Access Control | Yes — the core of this phase | Postgres RLS with `FORCE ROW LEVEL SECURITY`, GUC-keyed policies, fail-closed `current_setting(..., true)` + `NULLIF(..., '')::uuid` idiom; never enforce access control in application code alone |
| V5 Input Validation | Yes | Phone number format validation reusing the existing `WHATSAPP_RE`-equivalent hand-rolled regex from `lib/team/invite-member.ts` |
| V6 Cryptography | No | Nothing in this phase touches secrets/encryption — the credentials vault (BOV-01) is a later phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-client data leakage via a missing or incorrectly-reset GUC | Information Disclosure | `FORCE ROW LEVEL SECURITY` + fail-closed NULL-comparison (already proven pattern, Phase 1) + the isolation test suite this phase adds |
| Phone number reused across `team_members` and `authorized_contacts` causing identity misresolution | Elevation of Privilege | Cross-table trigger check (Pitfall 1), same shape as `client_assignments_agency_consistency` |
| `''` vs `NULL` on a reused pooled connection crashing (or worse, silently passing) a `uuid` GUC comparison | Tampering (of enforcement logic, not data) | `NULLIF(current_setting(...), '')::uuid` idiom, mandatory for every new `uuid`-typed GUC (0002's lesson) |
| WhatsApp sender-number spoofing / SIM reassignment (nothing in Genzia's control) | Spoofing | Accepted v1 risk — Genzia trusts Meta's Tech-Provider-attested sender number; no additional verification layer planned for v1. Worth a one-line note in `resolveIdentity`'s doc comment so this isn't mistaken for an oversight later. |
| Client contact roster (PII: name, phone, email) read by a scope that shouldn't see it | Information Disclosure | RLS policy design from Open Question #1/#2 — no `client_contact`-role SELECT branch on `authorized_contacts`, ever |

**Compliance note (pre-existing, not new to this phase):** STATE.md already
tracks an open item — "Confirmar residencia de datos en Colombia (Ley
1581/Habeas Data)" — relevant here because `authorized_contacts` is the first
table in the schema storing third-party (client contact) personal data
(name, phone, email) rather than team/agency data. This phase doesn't need to
resolve that open legal item, but the new table is exactly the kind of data
that item concerns — worth a one-line cross-reference in the migration's
comment, not a blocker.

## Sources

### Primary (HIGH confidence)
- `lib/tenant/with-tenant-context.ts` (repo, Phase 1) — GUC-setting transaction pattern
- `drizzle/migrations/0001_rls_policies.sql`, `0002_fix_clients_rls_uuid_cast.sql`, `0004_client_assignments_check.sql` (repo, Phase 1) — RLS policy idioms, the `NULLIF` fix, cross-table consistency trigger pattern
- `scripts/verify-rls-isolation.ts` (repo, Phase 1) — test suite pattern to mirror per D-07
- `lib/db/schema/team-members.ts`, `clients.ts`, `client-assignments.ts`, `agencies.ts`, `agent-brand-config.ts` (repo, Phase 1) — existing schema conventions
- `lib/team/invite-member.ts`, `lib/clients/assign-client.ts` (repo, Phase 1) — Server Action conventions, existing phone-validation regex, admin-only write precedent
- `.planning/phases/02-modelo-identidad-permisos/02-CONTEXT.md` and `02-DISCUSSION-LOG.md` — locked decisions and alternatives considered
- `.planning/PROJECT.md` §"Modelo de identidad y permisos", §"Autonomía y control del agente" — design source of truth
- `.planning/REQUIREMENTS.md` §"SEG" — formal requirement text
- `.planning/research/PITFALLS.md` #1, #2 — domain risk research (risk misclassification, opt-in gap)
- `.planning/STATE.md` — sandboxed-session network gate, pending Colombia data-residency item
- [VERIFIED: npm registry] `npm view drizzle-orm version` → `0.45.2`, matches the version already installed

### Secondary (MEDIUM confidence)
- None used beyond the above — this phase's research surface is entirely
  internal to the existing codebase and its planning documents; no external
  library/framework research was needed since no new dependencies are
  introduced.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, versions confirmed against the
  registry and the existing `package.json`
- Architecture: HIGH for the extension-of-existing-pattern parts (GUC
  mechanics, RLS idioms, test-script shape); MEDIUM for the two genuinely
  new design judgment calls flagged in Open Questions (#1 SEG-08 framing,
  #2 write-permission granularity) — these are real gaps CONTEXT.md left
  to "Claude's Discretion" but touch access-control semantics significant
  enough to warrant explicit planner/user confirmation
- Pitfalls: HIGH — Pitfalls 1/2/4 are derived directly from concrete,
  already-encountered bugs in this same codebase (0002's fix) or from
  already-completed domain research (PITFALLS.md #1/#2), not speculative

**Research date:** 2026-09-08
**Valid until:** No external expiry — this research is tied to the current
state of this codebase, not to a fast-moving external ecosystem; re-validate
only if Phase 1's schema/RLS files change before Phase 2 executes.
