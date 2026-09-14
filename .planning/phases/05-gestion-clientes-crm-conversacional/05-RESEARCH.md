# Phase 5: Gestión de clientes (CRM conversacional) - Research

**Researched:** 2026-09-14
**Domain:** Internal CRM data model + agent tools + Next.js CRUD UI on an existing multi-tenant RLS codebase (no new external dependencies)
**Confidence:** HIGH (all findings verified by reading the actual files in this repo — no framework/library unknowns, this phase is 100% internal-pattern-matching)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Campos mínimos `name`, `phone`, `email`, `industry`, `notes`. Nada de redes sociales, sitio web, dirección o tamaño de empresa.
- D-02: `name` + al menos uno de `phone`/`email` obligatorios al crear. `industry`/`notes` opcionales.
- D-03: `notes` es un solo campo de texto libre, sin tabla `client_notes` separada.
- D-04: `industry` es una lista fija bilingüe (código interno + label ES/EN). Set inicial sugerido delegado a Claude.
- D-05: `phone`/`email` del cliente en la ficha son informativos para el equipo, distintos y sin auto-vincular a `authorized_contacts`.
- D-06: `notes` es solo-equipo. `name`/`phone`/`email`/`industry` son visible-cliente (clasificación, el portal que los renderiza es Fase 9).
- D-07: Si falta `phone`/`email` en el dictado, el agente pregunta antes de crear.
- D-08: Nueva acción `create_client` en `agent_action_catalog`, riesgo bajo. Nueva migración (hoy solo `payment_reminder`/`reschedule_appointment`/`new_client_content`).
- D-09: Nombre duplicado → el agente confirma conversacionalmente, sin bloqueo duro.
- D-10: `update_client` — mismo patrón, mismo riesgo bajo, disponible por dictado.
- D-11 (decisión central): el agente tiene acceso de consulta Y edición sobre todo lo que el usuario ya ve por su rol — el alcance lo da RLS (`clients_select_by_role`), nunca un filtro de aplicación.
- D-12: `list_clients` (filtro texto plano ILIKE, sin embeddings) y `get_client`, mismo patrón que `draft-client-content.ts`, heredan scope de `withTenantContext`/RLS.
- D-13: Cualquier miembro (no solo admin) puede dar de alta un cliente; queda autoasignado a quien lo creó, reusando `assign-client.ts`.
- D-14: Sin borrado ni archivado de clientes en esta fase.
- D-15: La ficha muestra historial de conversación real + placeholders vacíos para pagos/próximas citas (mismo layout, se llenan en Fase 6/8).
- D-16: La ficha muestra asignación y permite reasignar ahí mismo (solo admin), reusando `assign-client.ts`.

### Claude's Discretion
- Set inicial exacto de categorías del dropdown de industria (D-04) — ya resuelto por el UI-SPEC aprobado (ver tabla abajo), no repetir el ejercicio.
- Estructura exacta de la migración de catálogo (D-08) — sigue `0008_agent_action_catalog_seed.sql`.
- Diseño visual/layout exacto de la ficha — ya resuelto por el UI-SPEC aprobado.

### Deferred Ideas (OUT OF SCOPE)
- Fase 6 (citas/calendario) — su propia fase, no se toca aquí salvo el placeholder vacío en la ficha (D-15).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLI-01 | Alta de cliente por formulario o dictado | Migration extending `clients` (phone/email/industry/notes) + RLS INSERT policy widened to any team_member (see Architecture Patterns §RLS gap) + `lib/clients/create-client.ts` + `create_client` agent tool |
| CLI-02 | Consulta de ficha: historial, pagos, próximas citas | `/dashboard/clients/[clientId]` page reusing `withTenantContext`, new `listConversationMessagesForClient()` query (extends `lib/audit/list-audit-log.ts` pattern), placeholder sections per D-15 |
| CLI-03 | Edición de datos | `client-form.tsx` shared create/edit + `lib/clients/update-client.ts` + `update_client` agent tool + RLS UPDATE policy |
| CLI-04 | Búsqueda por nombre o tema (reinterpreted as D-11) | `listClients()` extended with an optional ILIKE filter param, `client-search.tsx` syncing a URL search param, `list_clients` agent tool reusing the same filter |
| CLI-05 | Capas visible-cliente/solo-equipo | Column classification only this phase (no enforcement code needed — no client-facing surface exists yet, see Common Pitfalls) + UI-SPEC's `notes` box treatment |
| SEG-08 | Separación visible-cliente/solo-equipo | Same as CLI-05 — the real DB/RLS-level enforcement is deferred to Phase 9 (client portal); this phase only fixes the field classification and the internal-dashboard UI treatment |
</phase_requirements>

## Summary

This phase is pure internal-pattern extension — no new libraries, no new architectural layer. The `clients` table is a deliberate stub (per its own header comment) that this phase extends with four columns via a hand-authored SQL migration (next number: **0020**), following the exact style of every prior migration in `drizzle/migrations/`. Four new agent tools (`create_client`, `update_client`, `list_clients`, `get_client`) are added to the existing `lib/agent/tools/` registry, following `draft-client-content.ts`'s exact shape (manual input narrowing, no validation library). Two of those tools need a new `agent_action_catalog` migration (risk `low`, D-08). The web CRUD surface (list/search, create, edit, ficha) follows the UI-SPEC exactly — routes, copy, colors, and layout are already locked and checker-approved; this research does not re-litigate any of it.

**The one non-obvious, must-fix finding this research surfaces**: the existing `clients` table RLS write policy (`clients_write_admin_only`, migration `0001`/unchanged since) restricts **every** INSERT/UPDATE/DELETE to `app.role = 'admin'`. D-13 ("cualquier miembro del equipo puede dar de alta un cliente") is **structurally impossible today** without a new migration widening that policy — a non-admin `team_member`'s `create_client` call (agent tool OR web form) will be silently rejected by Postgres regardless of what the application code does, because both paths eventually open `withResolvedIdentityContext`/`withTenantContext`, which sets `app.role` from the caller's real row, and RLS enforces the `admin`-only check server-side. A second, equally load-bearing finding: `risk-interceptor.ts`'s `classifyAndExecute` **unconditionally requires** a valid UUID `clientId` argument on every tool call and rejects any call without one — this breaks `create_client` (no client exists yet) and `list_clients` (agency-wide search, no single client) out of the box. Both are fixable with small, well-scoped changes; both are detailed in Architecture Patterns and Common Pitfalls below with exact file/line references.

**Primary recommendation:** Extend the `clients` migration + RLS, extend `risk-interceptor.ts`'s clientId requirement to be conditional per-tool, then build the four new tools and the four new routes strictly by copying the cited existing files. No new packages, no new validation library, no new test framework — everything here already has a precedent in this codebase.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Client field storage (`phone`/`email`/`industry`/`notes`) | Database / Storage | — | Single ALTER TABLE on the existing `clients` table; no new table (D-01/D-03) |
| Role-scoped client visibility (who can SELECT which client) | Database / Storage (RLS) | — | Enforced by `clients_select_by_role`, never re-implemented in app code (D-11, STACK-WEB.md §2) |
| Role-scoped client writes (who can INSERT/UPDATE) | Database / Storage (RLS) | API/Backend (Server Actions/tool `execute()`) | RLS is the hard boundary; Server Actions/tools are the ergonomic entry point, not a second security check (except admin-only reassignment, which IS an app-layer check today) |
| Natural-language create/update/search/get | API/Backend (agent tools) | — | `lib/agent/tools/*.ts`, dispatched through `classifyAndExecute`, never bypasses RLS |
| Web form create/edit | Frontend Server (SSR + Server Actions) | Database / Storage (RLS) | Next.js Server Actions inside `withTenantContext`, same RLS as the agent path |
| Client list/search page, ficha | Frontend Server (SSR) | — | Server Components reading through `withTenantContext`, per UI-SPEC's "no modals, dedicated routes" convention |
| Conversation history on the ficha | Frontend Server (SSR) | Database / Storage | Reuses `messages` table + RLS's `messages_select_by_role`, filtered by `clientId` (new query, same table) |
| Assignment display/reassignment on the ficha | Frontend Server (SSR) + Client Component (toggle) | API/Backend (Server Action) | Reuses `lib/clients/assign-client.ts` verbatim (D-16) |

## Standard Stack

**No new external packages this phase.** Everything needed already exists in `package.json` (Next.js 16, Drizzle ORM, `@neondatabase/serverless`, `lucide-react`, `next-intl`, Clerk, `@anthropic-ai/sdk` types). Skipping the npm-install/Package Legitimacy Audit sections — there is nothing to audit.

### Internal modules this phase extends (not "installs")

| Module | Purpose | Why this one |
|--------|---------|---------------|
| `lib/db/schema/clients.ts` | Add `phone`, `email`, `industry`, `notes` columns | It is the stub the schema's own comment names for this exact purpose |
| `lib/agent/tools/index.ts` | Register 4 new tools | Single registry, `toolsFor()`/`executeTool()` pattern already exists |
| `lib/agent/risk-interceptor.ts` | Extend `TOOL_TO_CATALOG_CODE` + make `clientId` extraction conditional | Single SEG-10 gate every tool call passes through |
| `lib/clients/assign-client.ts` | Extract an internal (non-admin-gated) assignment helper for self-assign-on-create | D-13 needs this; the exported `assignClient()` is admin-gated on purpose (see Common Pitfalls) |
| `lib/clients/list-clients.ts` | Add an optional text-filter param | D-12/CLI-04's `list_clients` tool and the web search box both need the same filter |
| `lib/audit/list-audit-log.ts` | Add a client-scoped variant of `listRecentConversationMessages` | D-15's ficha needs per-client history; the existing function is agency-wide |
| `messages/es.json` / `messages/en.json` | New `Clients`/`Clientes`... actually keep `Clients` namespace key (see Copywriting note below) | Matches `Team`/`Bitacora`/`BrandSettings` namespace convention |

## Architecture Patterns

### System Architecture Diagram

```
Web form (create/edit)              WhatsApp / web chat dictation
      │                                        │
      ▼                                        ▼
Server Action                          runTurn() → classifyAndExecute()
(withTenantContext, Clerk)             (withResolvedIdentityContext)
      │                                        │
      └──────────────┬─────────────────────────┘
                      ▼
         lib/clients/create-client.ts / update-client.ts
         (shared validation: name + phone-or-email)
                      │
                      ▼
         INSERT/UPDATE clients  (RLS: clients_insert_by_team_member /
                                       clients_update_by_role)
                      │
              (create only) ▼
         INSERT client_assignments (self-assign the creator, D-13 —
         bypasses assign-client.ts's admin gate on purpose)
                      │
                      ▼
              writeAuditLog() → audit_log (bitácora, SEG-11)

Read side (list/search/ficha):
Web page (Server Component)  ──┐
                                ├──► listClients(filter?) / getClient(id)
Agent tool list_clients/get_client ─┘        │
                                              ▼
                                   SELECT ... FROM clients
                                   (RLS: clients_select_by_role — the
                                    ONLY scoping mechanism, D-11)
```

### Recommended Project Structure

```
lib/
├── db/schema/clients.ts          # extended, not replaced
├── clients/
│   ├── list-clients.ts           # extended: optional q filter
│   ├── assign-client.ts          # extended: internal self-assign helper
│   ├── create-client.ts          # NEW — shared by web action + agent tool
│   ├── update-client.ts          # NEW — shared by web action + agent tool
│   └── get-client.ts             # NEW — single-client fetch by id (RLS-scoped)
├── clients/industries.ts         # NEW — INDUSTRY_CODES bilingual list (D-04)
├── agent/tools/
│   ├── create-client.ts          # NEW tool, catalogCode "create_client"
│   ├── update-client.ts          # NEW tool, catalogCode "update_client"
│   ├── list-clients.ts           # NEW tool (no clientId arg — see Pitfall 2)
│   └── get-client.ts             # NEW tool
├── agent/risk-interceptor.ts     # extended: conditional clientId requirement
└── audit/list-audit-log.ts       # extended: listConversationMessagesForClient(clientId)

app/[locale]/dashboard/clients/
├── page.tsx                      # list + search (Server Component)
├── client-search.tsx             # "use client", debounced, syncs ?q=
├── client-list.tsx                # Server Component, <ul> pattern like AuditList
├── new/page.tsx                  # create form page
├── client-form.tsx               # "use client", shared create/edit
└── [clientId]/
    ├── page.tsx                  # ficha (Server Component)
    ├── conversation-history.tsx  # read-only bubble reuse of chat-panel.tsx
    ├── assignment-panel.tsx      # "use client", reuses assign-clients-form.tsx pattern
    └── edit/page.tsx             # reuses client-form.tsx, pre-filled

drizzle/migrations/
├── 0020_clients_crm_fields.sql          # ALTER TABLE + industry check constraint
├── 0021_clients_write_by_team_member.sql # RLS widening (the load-bearing fix)
└── 0022_agent_action_catalog_client.sql  # create_client/update_client seed rows
```

### Pattern 1: Extending the `clients` table (migration 0020)

**What:** ALTER TABLE, not a new table — `clients` already has RLS/FKs pointed at it.
**When to use:** Exactly this phase, exactly once.
**Example (schema, `lib/db/schema/clients.ts`):**
```typescript
// Source: pattern copied from lib/db/schema/team-members.ts's role/status
// check-constraint convention — this repo never uses pgEnum (verified: zero
// hits for "pgEnum" across lib/db/schema/*.ts).
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { agencies } from "./agencies";

export const CLIENT_INDUSTRY_CODES = [
  "restaurants_food", "health_beauty", "fashion_retail",
  "professional_services", "real_estate", "fitness_sports",
  "education", "other",
] as const;

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: text("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    industry: text("industry"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "clients_industry_check",
      sql`${table.industry} is null or ${table.industry} in ('restaurants_food','health_beauty','fashion_retail','professional_services','real_estate','fitness_sports','education','other')`,
    ),
    // D-02: name + at least one of phone/email, enforced at the DB layer too
    // (defense in depth — app-layer validation is the primary UX gate, see
    // Validation Architecture below).
    check(
      "clients_contact_required_check",
      sql`${table.phone} is not null or ${table.email} is not null`,
    ),
  ],
);
```
Migration `0020` mirrors this with `ALTER TABLE clients ADD COLUMN ...` + `ADD CONSTRAINT` (no `_journal.json` special-casing beyond appending the standard entry — see `drizzle/migrations/meta/_journal.json`'s last 4 entries for the exact `{ idx, version: "7", when, tag, breakpoints: true }` shape).

### Pattern 2: The RLS write-policy gap (migration 0021) — REQUIRED, not optional

**What:** `0001_rls_policies.sql` (lines 139-148) created `clients_write_admin_only`, a single `FOR ALL` policy gating every INSERT/UPDATE/DELETE on `agency_id` + `app.role = 'admin'`. Nothing since has touched it (confirmed: `grep clients_write_admin_only drizzle/migrations/*` only matches `0001`).
**Why this breaks D-13:** every write path — the agent tool's `execute()` (via `withResolvedIdentityContext`, same as `deliver-to-client.ts`) and the web form's Server Action (via `withTenantContext`) — sets `app.role` from the **actual caller's** `team_members.role`. A `member` calling `create_client` (by dictation OR by form) will have their INSERT rejected by Postgres with a real RLS violation, not a graceful "not admin" message — because nothing in application code currently checks admin-ness before the client tool's `execute()`/action runs (unlike `assignClient()`, which explicitly calls `assertCallerIsAdmin`).
**Recommended fix** (three separate policies, since Postgres RLS policies can be scoped `FOR INSERT`/`FOR UPDATE`/`FOR DELETE` independently — INSERT cannot check assignment because the row, and therefore the assignment, doesn't exist yet):
```sql
-- Source: pattern extends 0001_rls_policies.sql's own clients section
DROP POLICY clients_write_admin_only ON clients;
--> statement-breakpoint

-- D-13: any team member may create a new client (self-assignment happens
-- in a separate client_assignments insert right after, see Pattern 3).
CREATE POLICY clients_insert_by_team_member ON clients
  FOR INSERT
  WITH CHECK (
    agency_id = current_setting('app.agency_id', true)
    AND current_setting('app.role', true) in ('admin', 'member')
  );
--> statement-breakpoint

-- D-11: write visibility mirrors read visibility exactly — admin edits
-- everything, a member only what they're assigned (client_assignments),
-- same three-branch spirit as clients_select_by_role (client_contact gets
-- no branch here on purpose — client_contact must never write clients).
CREATE POLICY clients_update_by_role ON clients
  FOR UPDATE
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND (
      current_setting('app.role', true) = 'admin'
      OR id IN (SELECT client_id FROM client_assignments
                WHERE team_member_id = NULLIF(current_setting('app.team_member_id', true), '')::uuid)
    )
  )
  WITH CHECK ( /* identical predicate */ );
--> statement-breakpoint

-- D-14: no delete/archive feature exists this phase — keep DELETE
-- admin-only as a conservative default (nothing calls it either way).
CREATE POLICY clients_delete_admin_only ON clients
  FOR DELETE
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND current_setting('app.role', true) = 'admin'
  );
```
This is a research-driven structural requirement to make D-13 physically possible — not a new product decision, so it does not need to go back through `/gsd:discuss-phase`. The planner should treat it as a mandatory migration task, verified by extending `scripts/verify-agent-rls.ts` or `scripts/verify-rls-isolation.ts` with a "member creates client, member cannot edit unassigned client, member can edit assigned client" assertion set.

### Pattern 3: Self-assignment on create (D-13) — do not literally reuse `assignClient()`

**What:** `lib/clients/assign-client.ts`'s exported `assignClient(clientId, teamMemberId)` calls `assertCallerIsAdmin(tx, userId)` before writing — by design, for the *reassignment* UI (D-16, admin-only). D-13's context text says the create flow "reusa `assign-client.ts` existente" — read literally, calling the exported function as-is would make every non-admin's client creation fail at the assignment step (defeating the whole point of D-13).
**Recommended fix:** extract the insert itself into a small internal helper inside `assign-client.ts`, shared by both call sites:
```typescript
// Source: factored out of the existing assignClient() body verbatim
async function insertAssignment(
  tx: TenantTx, // or IdentityTx, depending which context the caller opened
  agencyId: string,
  clientId: string,
  teamMemberId: string,
): Promise<void> {
  await tx.insert(clientAssignments)
    .values({ agencyId, clientId, teamMemberId })
    .onConflictDoNothing({ target: [clientAssignments.clientId, clientAssignments.teamMemberId] });
}
```
`assignClient()` keeps its `assertCallerIsAdmin` call and then calls `insertAssignment`. The new `lib/clients/create-client.ts` calls `insertAssignment` directly, immediately after inserting the new `clients` row, with `teamMemberId` = the creator's own id — no admin check needed, since a member self-assigning to the client they just created is exactly what D-13 asks for, not a privilege escalation. `client_assignments`'s own RLS policy (`client_assignments_tenant_isolation`, extended by `0007`) has no role branch — any non-`client_contact` team member can already write there at the DB layer; the admin gate today is purely the application-level `assertCallerIsAdmin` call, confirmed by reading `0001_rls_policies.sql` and `0007_client_contact_scope.sql` end to end.

### Pattern 4: Agent tool shape (copy `draft-client-content.ts` exactly)

```typescript
// Source: lib/agent/tools/draft-client-content.ts, adapted
export const catalogCode = "create_client";

export const definition: Anthropic.Messages.Tool = {
  name: "create_client",
  description: "Da de alta un cliente nuevo. Requiere nombre y al menos teléfono o correo.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      phone: { type: "string", description: "Opcional si se da email" },
      email: { type: "string", description: "Opcional si se da phone" },
      industry: { type: "string", description: "Uno de: restaurants_food, health_beauty, fashion_retail, professional_services, real_estate, fitness_sports, education, other" },
      notes: { type: "string" },
    },
    required: ["name"],
  },
};

type CreateClientInput = { name: string; phone?: string; email?: string; industry?: string; notes?: string };

// Hand-written narrowing, no runtime schema-validation dependency — repo
// posture (see parse-webhook-payload.ts's own header comment).
function isValidInput(input: unknown): input is CreateClientInput {
  if (typeof input !== "object" || input === null) return false;
  const r = input as Record<string, unknown>;
  if (typeof r.name !== "string" || r.name.trim().length === 0) return false;
  for (const key of ["phone", "email", "industry", "notes"]) {
    if (r[key] !== undefined && typeof r[key] !== "string") return false;
  }
  return true;
}

export async function execute(input: unknown, actor: TurnActor): Promise<string> {
  if (!isValidInput(input)) return "Entrada inválida: se requiere al menos name.";
  if (!input.phone && !input.email) {
    // D-07: never create with incomplete data — the model must ask back.
    return "Falta un dato de contacto: pide teléfono o correo antes de crear el cliente.";
  }
  const result = await createClient({ agencyId: actor.agencyId, identity: actor.identity, ...input });
  // ...D-09 duplicate-name confirmation surfaces here as a returned string,
  // not a thrown error — the model relays it and asks the human back.
  return result.message;
}
```
`create_client`/`update_client` are registered in `TOOL_TO_CATALOG_CODE` (`risk-interceptor.ts`) exactly like the existing two. Both resolve to `risk_level = 'low'` per the new catalog rows (D-08), so `classifyAndExecute`'s low branch executes them inline — no approval queue involvement, matching `send_payment_reminder`'s path, never `draft_client_content`'s (high) path.

### Anti-Patterns to Avoid
- **Re-filtering `clients` by role in application code** — the entire point of D-11 is that RLS alone decides scope. Any `WHERE` clause added in `lib/clients/*.ts` beyond the search-text filter (name/industry/notes ILIKE) is the exact anti-pattern `list-clients.ts`'s own header comment and `STACK-WEB.md §2` warn against.
- **Calling `assignClient()` directly from the create flow** — see Pattern 3. It will `throw NotAdminError` for every non-admin creator, silently breaking D-13.
- **Giving `create_client`/`list_clients` a fake/placeholder `clientId` argument just to satisfy `classifyAndExecute`'s current UUID check** — this pollutes the tool's actual input schema with a meaningless required field the model has no real value for. Fix the interceptor instead (Pitfall 2 below), don't work around it in the tool schema.
- **Adding a runtime validation library (zod, etc.) for the new tool inputs** — this repo has an explicit, repeated, deliberate decision against it (`parse-webhook-payload.ts`'s header comment, repeated verbatim in every existing tool file). Introducing one now for CRM fields specifically would be the first inconsistency in an otherwise uniform codebase.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Role-scoped client visibility | A manual `if (role === 'admin')` branch in `lib/clients/*.ts` | `clients_select_by_role` (already exists) | This is literally D-11's central point — RLS already does this |
| Debounced search-by-URL-param | A custom debounce hook from scratch | A small local `useEffect` + `setTimeout` (there is no existing debounce utility in this repo to reuse — confirmed via grep, no `lodash`/`use-debounce` dependency) | Keep it minimal; this is genuinely new to the codebase but doesn't need a package for one `<input>` |
| Bilingual industry labels | Hardcoded ES/EN strings inline in the `<select>` | `messages/{es,en}.json` under `Clients.industries.<code>`, read via `next-intl`'s `t()` (per UI-SPEC's own instruction: "Label text comes from the active locale via next-intl, not from a hardcoded ES/EN string in the option list") | Matches every other bilingual label in the app |
| Duplicate-name detection (D-09) | A fuzzy-matching library | A plain case-insensitive `ILIKE` exact-or-near match against `clients.name` scoped by the caller's own RLS-visible rows, surfaced as a confirmation string the model relays — no blocking, no separate dedup service | D-09 explicitly wants a soft, conversational check, not a hard uniqueness constraint |

**Key insight:** every "hard" problem in this phase is already solved by an existing piece of this same codebase; the actual work is wiring, not invention.

## Common Pitfalls

### Pitfall 1: RLS write policy blocks D-13 outright (see Pattern 2)
**What goes wrong:** A non-admin team member's `create_client` call (dictation or form) fails with a raw Postgres RLS error, not a friendly message.
**Why it happens:** `clients_write_admin_only` (migration `0001`) has never been revisited; it still says `admin` only.
**How to avoid:** Ship migration `0021` (or fold into `0020`) before any create/update code path is exercised.
**Warning signs:** Any manual test where a `member`-role user creates a client throws `new row violates row-level security policy for table "clients"`.

### Pitfall 2: `classifyAndExecute` hard-requires a `clientId` UUID on every tool call
**What goes wrong:** `create_client` (no client exists yet) and `list_clients` (agency-wide search) will be rejected with "El argumento clientId no es un identificador válido" on every single invocation, because `risk-interceptor.ts` lines 94-100 unconditionally extract and validate `clientId` from `toolUse.input` before ever reaching `executeTool`.
**Why it happens:** the interceptor was written when both existing tools (`send_payment_reminder`, `draft_client_content`) were client-scoped by construction; nothing exercised the "agency-scoped action" case before this phase.
**How to avoid:** add a small per-tool-name allowlist (e.g. `const CLIENT_SCOPED_TOOLS = new Set(["send_payment_reminder", "draft_client_content", "update_client", "get_client"])`) and only run the clientId-extraction/UUID-validation/client_contact-cross-check block when `toolUse.name` is in that set. `create_client` and `list_clients` skip straight to classification with `clientId = null` (already a supported value in `writeAuditLog`, confirmed by its `clientId: string | null` signature).
**Warning signs:** every `create_client`/`list_clients` call returns a rejected `tool_result` with the clientId error text, even with perfectly valid input.

### Pitfall 3: The old admin-only "quick add" client flow still exists and now has divergent validation
**What goes wrong:** `lib/clients/assign-client.ts`'s existing `addClient(name)` (admin-only, name-only, no phone/email requirement) is still wired into `app/[locale]/dashboard/team/[memberId]/assign-clients-form.tsx` (the `Team.addClientLabel`/`addClientPlaceholder`/`addClientSubmit` i18n keys). After this phase ships D-02 (name + phone-or-email required), this old path becomes a second, inconsistent way to create a client that bypasses the new requirement entirely and never self-assigns to anyone but leaves the client unassigned (the admin then has to check the box separately) — CONTEXT.md does not mention deprecating it.
**Why it happens:** it was CTA-06's (Phase 1) minimal stand-in, explicitly commented as such ("Full CRM client intake is Phase 5's CLI-01").
**How to avoid:** the planner should decide explicitly (this is a genuine open question, not resolved by CONTEXT.md or the UI-SPEC) whether to (a) remove the quick-add form from the Team page and point it at `/dashboard/clients/new` instead, or (b) leave it as a deliberate "quick, name-only, admin-only" shortcut with the old lax validation. Recommendation: remove it — leaving two divergent client-creation paths with different validation rules is the kind of drift this codebase has consistently avoided elsewhere (see Open Questions).
**Warning signs:** a client with no `phone`/`email` exists in the database despite D-02 supposedly requiring one.

### Pitfall 4: `_journal.json` must be updated by hand for every new migration
**What goes wrong:** `npm run db:migrate` (via `drizzle-orm/neon-http/migrator`) reads `drizzle/migrations/meta/_journal.json` to know which files to apply, in order. A `.sql` file dropped into the folder without a matching journal entry is silently skipped.
**Why it happens:** this project generates migrations by hand (no `drizzle-kit generate`/`push`), so nothing updates the journal automatically.
**How to avoid:** append one `{ idx, version: "7", when: <ms-epoch>, tag: "00NN_name", breakpoints: true }` object per new migration, `idx` continuing from `19` (the last entry today) — `20`, `21`, `22`.
**Warning signs:** a migration "ran" (file exists, no error) but its DDL never actually applied against Neon.

### Pitfall 5: Two different `withTenantContext`-shaped GUCs, don't mix them up
**What goes wrong:** using `withTenantContext` (Clerk-session-based, `server-only`) inside a tool's `execute()` — it will crash any code path that isn't a real Next.js server-rendering request (including every WhatsApp turn, and every `tsx` verification script).
**Why it happens:** both helpers set the *same* GUC names (`app.agency_id`/`app.team_member_id`/`app.role`) and look interchangeable at a glance.
**How to avoid:** tool `execute()` functions (and anything `deliverToClient`-shaped) always use `withResolvedIdentityContext(actor.agencyId, actor.identity, ...)`, exactly like `deliver-to-client.ts` already does — never `withTenantContext`. Web-only Server Actions/pages (`create-client.ts`'s web-form entry point, `page.tsx` files) use `withTenantContext`, exactly like `assign-client.ts`/`brand-form.tsx`'s action already do.
**Warning signs:** `tsx scripts/verify-*.ts` throwing on import, or a WhatsApp-only code path crashing with a Clerk-session error.

## Code Examples

### Client-scoped conversation history query (extends `lib/audit/list-audit-log.ts`)
```typescript
// Source: adapted from listRecentConversationMessages in this same file —
// same shape, one added predicate. No new role/scope logic (RLS already
// governs what's visible via messages_select_by_role).
export async function listConversationMessagesForClient(
  clientId: string,
  limit = 100,
): Promise<ConversationEntry[]> {
  return withTenantContext((tx) =>
    tx
      .select({
        id: messages.id,
        createdAt: messages.createdAt,
        direction: messages.direction,
        channel: messages.channel,
        messageType: messages.messageType,
        textBody: messages.textBody,
        clientName: clients.name,
      })
      .from(messages)
      .leftJoin(clients, eq(messages.clientId, clients.id))
      .where(eq(messages.clientId, clientId))
      .orderBy(desc(messages.createdAt))
      .limit(limit),
  );
}
```

### `listClients` with an optional text filter (D-12/CLI-04)
```typescript
// Source: adapted from the existing listClients() in lib/clients/list-clients.ts
import { ilike, or } from "drizzle-orm";

export async function listClients(query?: string): Promise<ClientRow[]> {
  return withTenantContext((tx) => {
    const base = tx.select().from(clients);
    if (!query || query.trim().length === 0) {
      return base.orderBy(clients.name);
    }
    const pattern = `%${query.trim()}%`;
    return base
      .where(or(ilike(clients.name, pattern), ilike(clients.industry, pattern), ilike(clients.notes, pattern)))
      .orderBy(clients.name);
  });
}
```
The `list_clients` agent tool and the web `client-search.tsx` both call this exact function with the same `query` string — no divergence, per D-12's "mismo criterio que `lib/clients/list-clients.ts` ya documenta".

## State of the Art

Not applicable — no external framework/library versions are in play this phase. Everything is this repo's own established convention as of Phase 4 (already current, dated 2026-09-14).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The RLS write-policy split into 3 policies (INSERT any-team-member / UPDATE admin-or-assigned / DELETE admin-only) is the correct shape to satisfy D-13 while staying consistent with D-11's "write mirrors read" principle | Architecture Patterns, Pattern 2 | If wrong, a member could either be blocked from editing their own assigned clients, or could edit clients outside their assignment — planner should have `db:verify-rls`-style assertions cover both directions explicitly |
| A2 | `create_client`/`update_client`/`list_clients`/`get_client` should be added to `TOOL_TO_CATALOG_CODE` with catalog codes identical to the tool names (`create_client`, `update_client`) | Architecture Patterns, Pattern 4 | Low risk — directly follows the existing `payment_reminder`→`send_payment_reminder` naming precedent, but `list_clients`/`get_client` need a catalog code too even though they're read-only, since `classifyAndExecute` runs for every tool_use unconditionally (confirmed in `run-turn.ts`) — recommend risk `low` for both reads, or consider a lighter-weight bypass for pure reads if the planner prefers not to seed two more catalog rows for non-actions. This design choice is not fixed by CONTEXT.md and should be confirmed during planning. |
| A3 | Removing the old admin-only quick-add flow (Pitfall 3) is the right call, rather than leaving it | Common Pitfalls, Pitfall 3 | If wrong (user wants to keep the quick shortcut), the planner should at minimum align its validation with D-02 rather than leave two silently different rules |

**If this table is empty:** N/A — see above, not empty.

## Open Questions

1. **Should `list_clients`/`get_client` require an `agent_action_catalog` row at all, given they're read-only?**
   - What we know: `classifyAndExecute` runs unconditionally for every `tool_use` block (`run-turn.ts` line 170) and rejects any tool name with no `TOOL_TO_CATALOG_CODE` entry.
   - What's unclear: whether seeding two more `risk = 'low'` catalog rows for reads is the intended pattern, or whether a future refactor should exempt pure reads from classification entirely.
   - Recommendation: seed them as `low` risk this phase (simplest, fully consistent with the existing every-tool-passes-through-the-gate design) and leave a note that "read-only tool fast path" is a possible future refactor, not a Phase 5 concern.

2. **What happens to the old Team-page quick-add flow (Pitfall 3)?**
   - What we know: it exists, is wired into a live page, and its validation (name-only) will diverge from D-02 once this phase ships.
   - What's unclear: whether the user wants it removed, redirected, or left as an intentional shortcut.
   - Recommendation: default to removing it and pointing the Team page's "add client" affordance at `/dashboard/clients/new`, since CONTEXT.md's `code_context` section explicitly describes `clients.ts`'s stub comment as "Phase 5 adds the real client fields... via a later migration" — implying the old flow was never meant to survive this phase unchanged.

## Environment Availability

Skipped — this phase has no external dependencies beyond the already-provisioned Neon/Clerk stack every prior phase already depends on. No new services, no new env vars.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None (no jest/vitest/pytest in this repo) — hand-rolled `tsx scripts/verify-*.ts` scripts run against real Neon, the established pattern since Phase 1 |
| Config file | none — see `package.json`'s `db:verify-*`/`verify:*` scripts |
| Quick run command | `npx tsc --noEmit && npx eslint .` (typecheck + lint — the only "quick" checks that don't need live Neon) |
| Full suite command | `npm run db:verify-rls && npm run db:verify-agent-rls && npm run db:verify-agent` (requires `DATABASE_URL` with real network egress — not runnable in every sandboxed session, per STATE.md's own repeated note) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLI-01 | Member creates client via form/dictation, gets auto-assigned | integration (real Neon) | extend `scripts/verify-agent-rls.ts` with a `member`-role INSERT assertion | ❌ Wave 0 |
| CLI-03 | Member can edit assigned client, cannot edit unassigned client | integration (real Neon) | extend `scripts/verify-rls-isolation.ts` or `verify-agent-rls.ts` | ❌ Wave 0 |
| CLI-04 | `list_clients`/web search returns only RLS-visible rows, filtered by text | integration (real Neon) | new assertions in `verify-agent-rls.ts` | ❌ Wave 0 |
| CLI-02/CLI-05 | Ficha shows real conversation history scoped to one client | manual + integration (existing `messages_select_by_role` coverage already proves the RLS half) | visual/manual check per UI-SPEC | n/a |
| D-07 | Agent refuses to create with no phone/email, asks back | unit-ish (no DB, pure function) | new `scripts/verify-agent-prompt.ts`-style addition, or covered inside the tool's own `isValidInput`/execute logic tested via `db:verify-agent` | ❌ Wave 0 |
| D-08/SEG-10 | `create_client`/`update_client` classify as `low` and auto-execute | integration (real Neon) | extend `scripts/verify-agent-rls.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit && npx eslint .`
- **Per wave merge:** full `db:verify-*` suite against real Neon (same checkpoint discipline as Phase 4's `04-12`)
- **Phase gate:** all `db:verify-*` scripts green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Extend `scripts/verify-agent-rls.ts` (or a new `scripts/verify-clients-crm.ts`) with member-vs-admin write assertions for the new RLS policies — the single most important test this phase needs, since it's the only thing that would catch a regression on Pitfall 1.
- [ ] Extend the same script (or `verify-agent-prompt.ts`) with `create_client`/`update_client`/`list_clients`/`get_client` classification assertions (Pitfall 2's fix, verified).
- [ ] No new test framework install needed.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (unchanged — Clerk, existing) | — |
| V3 Session Management | no (unchanged) | — |
| V4 Access Control | **yes** | Postgres RLS (`clients_insert_by_team_member`/`clients_update_by_role`/`clients_select_by_role`) — the entire point of Pattern 2 above; never an app-layer filter |
| V5 Input Validation | yes | Manual TypeScript narrowing (repo posture, no zod) for tool inputs; native HTML form validation + server-side re-check (name + phone-or-email) for the web form, matching `BrandForm`'s pattern |
| V6 Cryptography | no (no new secrets/crypto this phase) | — |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt-injection-driven cross-client data access via a dictated `clientId` argument | Elevation of Privilege | `classifyAndExecute`'s existing scope cross-check (client_contact vs. clientId match) — must remain intact for `update_client`/`get_client` after Pitfall 2's fix; only `create_client`/`list_clients` should skip it, never the client-scoped tools |
| A non-admin escalating to admin-only actions (reassignment) by calling the Server Action directly, bypassing UI | Elevation of Privilege | `assertCallerIsAdmin` in `lib/team/current-member.ts`, already used by `assignClient`/`unassignClient`; unaffected by this phase, must NOT be added to the new self-assign-on-create helper (Pattern 3) |
| Client-facing data leak of `notes` (team-only) once a future portal exists | Information Disclosure | Out of enforcement scope this phase (no client-facing surface reads `clients` at all today — confirmed by reading `build-context.ts`, which never queries the `clients` table for any identity type); Phase 9 must add an explicit column allowlist when it builds the portal query, this phase's job is only the correct column classification (D-06) |

## Sources

### Primary (HIGH confidence — read directly this session)
- `lib/db/schema/clients.ts`, `client-assignments.ts`, `authorized-contacts.ts`, `team-members.ts`, `agent-action-catalog.ts`
- `drizzle/migrations/0001_rls_policies.sql`, `0002_fix_clients_rls_uuid_cast.sql`, `0004_client_assignments_check.sql`, `0007_client_contact_scope.sql`, `0008_agent_action_catalog_seed.sql`, `meta/_journal.json`
- `lib/clients/list-clients.ts`, `assign-client.ts`
- `lib/agent/tools/index.ts`, `draft-client-content.ts`, `send-payment-reminder.ts`, `deliver-to-client.ts`
- `lib/agent/risk-interceptor.ts`, `run-turn.ts`, `build-context.ts`, `web-chat.ts`, `audit.ts`, `types.ts`
- `lib/tenant/with-tenant-context.ts`, `with-resolved-identity-context.ts`
- `lib/team/current-member.ts`, `lib/identity/types.ts`
- `lib/audit/list-audit-log.ts`, `app/[locale]/dashboard/bitacora/page.tsx`, `audit-list.tsx`
- `app/[locale]/dashboard/team/[memberId]/assign-clients-form.tsx`, `app/[locale]/dashboard/settings/brand/brand-form.tsx`, `app/[locale]/dashboard/chat/chat-panel.tsx`
- `messages/es.json` (Team/Bitacora namespaces)
- `.planning/phases/05-gestion-clientes-crm-conversacional/05-CONTEXT.md`, `05-UI-SPEC.md`
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/config.json`
- `package.json` (scripts), `scripts/migrate.ts`, `scripts/verify-agent-rls.ts`

### Secondary / Tertiary
- None — no WebSearch/Context7 lookups were needed; this phase has zero external-library surface. Everything is internal-codebase pattern research.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, verified by reading `package.json`
- Architecture: HIGH — every pattern cited was read directly from the actual file, not recalled from training
- RLS gap (Pattern 2) and clientId gap (Pitfall 2): HIGH — both confirmed by reading the exact policy/interceptor code, not inferred
- Pitfalls: HIGH for 1/2/4/5 (all directly observed in code); MEDIUM for 3 (a judgment call on user intent, flagged as Open Question, not asserted as fact)

**Research date:** 2026-09-14
**Valid until:** 30 days (stable internal codebase, no external API drift risk) — but re-verify the RLS/`_journal.json` state if any other phase's migrations land on `main` before Phase 5 executes, since the "next migration number" (0020) is a moving target.
