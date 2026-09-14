# Phase 5: Gestión de clientes (CRM conversacional) - Pattern Map

**Mapped:** 2026-09-14
**Files analyzed:** 24 (new + modified)
**Analogs found:** 22 / 24 (2 have no direct analog — new territory, see "No Analog Found")

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `lib/db/schema/clients.ts` (MOD — add columns) | model | CRUD | `lib/db/schema/team-members.ts` (check-constraint convention) | role-match |
| `drizzle/migrations/0020_clients_crm_fields.sql` | migration | batch (DDL) | `drizzle/migrations/0004_client_assignments_check.sql` (ALTER + CHECK) | exact |
| `drizzle/migrations/0021_clients_write_by_team_member.sql` | migration | batch (DDL/RLS) | `drizzle/migrations/0001_rls_policies.sql` (clients section, lines 109-148) | exact |
| `drizzle/migrations/0022_agent_action_catalog_client.sql` | migration | batch (seed) | `drizzle/migrations/0008_agent_action_catalog_seed.sql` | exact |
| `lib/clients/list-clients.ts` (MOD — add `q` filter) | service | CRUD | itself (extend in place) | exact |
| `lib/clients/assign-client.ts` (MOD — extract `insertAssignment`) | service | CRUD | itself (extend in place) | exact |
| `lib/clients/create-client.ts` | service | CRUD | `lib/brand/update-brand-config.ts` (Server-Action-shaped validation + write) | role-match |
| `lib/clients/update-client.ts` | service | CRUD | `lib/brand/update-brand-config.ts` | role-match |
| `lib/clients/get-client.ts` | service | CRUD (single-row read) | `lib/clients/list-clients.ts` (`listAssignedClientIds`) | role-match |
| `lib/clients/industries.ts` | config/utility | transform (static lookup) | `lib/brand/tone.ts` (`BRAND_TONES` bilingual-label pattern) | exact |
| `lib/agent/tools/create-client.ts` | service (agent tool) | event-driven | `lib/agent/tools/draft-client-content.ts` | exact |
| `lib/agent/tools/update-client.ts` | service (agent tool) | event-driven | `lib/agent/tools/draft-client-content.ts` | exact |
| `lib/agent/tools/list-clients.ts` | service (agent tool) | event-driven (agency-scoped, no clientId) | `lib/agent/tools/send-payment-reminder.ts` (shape) + `list-clients.ts` (query) | role-match |
| `lib/agent/tools/get-client.ts` | service (agent tool) | event-driven | `lib/agent/tools/draft-client-content.ts` | exact |
| `lib/agent/tools/index.ts` (MOD — register 4 new tools) | service (registry) | event-driven | itself (extend in place) | exact |
| `lib/agent/risk-interceptor.ts` (MOD — conditional clientId + catalog map) | middleware | event-driven | itself (extend in place) | exact |
| `lib/audit/list-audit-log.ts` (MOD — add `listConversationMessagesForClient`) | service | CRUD (read) | itself (`listRecentConversationMessages`, same file) | exact |
| `app/[locale]/dashboard/clients/page.tsx` | route (Server Component) | request-response | `app/[locale]/dashboard/bitacora/page.tsx` | exact |
| `app/[locale]/dashboard/clients/client-search.tsx` | component ("use client") | request-response (debounced URL sync) | none close — see "No Analog Found" | none |
| `app/[locale]/dashboard/clients/client-list.tsx` | component (Server Component) | request-response | `app/[locale]/dashboard/bitacora/audit-list.tsx` | exact |
| `app/[locale]/dashboard/clients/new/page.tsx` | route (Server Component) | request-response | `app/[locale]/dashboard/team/[memberId]/page.tsx` | role-match |
| `app/[locale]/dashboard/clients/client-form.tsx` | component ("use client", shared create/edit) | request-response | `app/[locale]/dashboard/settings/brand/brand-form.tsx` | exact |
| `app/[locale]/dashboard/clients/[clientId]/page.tsx` | route (Server Component, ficha) | request-response | `app/[locale]/dashboard/bitacora/page.tsx` (multi-section SSR page) | role-match |
| `app/[locale]/dashboard/clients/[clientId]/conversation-history.tsx` | component (Server Component, read-only) | request-response | `app/[locale]/dashboard/bitacora/page.tsx` (conversation `<ul>` section, lines 90-113) | exact |
| `app/[locale]/dashboard/clients/[clientId]/assignment-panel.tsx` | component ("use client") | request-response | `app/[locale]/dashboard/team/[memberId]/assign-clients-form.tsx` | exact |
| `app/[locale]/dashboard/clients/[clientId]/edit/page.tsx` | route (Server Component) | request-response | `app/[locale]/dashboard/clients/new/page.tsx` (itself, pre-filled) | exact |
| `app/[locale]/dashboard/team/[memberId]/assign-clients-form.tsx` (MOD — remove/redirect quick-add) | component ("use client") | request-response | itself (modify in place) | exact |
| `messages/es.json` / `messages/en.json` (MOD — new `Clients` namespace) | config (i18n) | transform | `messages/es.json`'s `Team`/`Bitacora` namespaces | exact |

## Pattern Assignments

### `lib/db/schema/clients.ts` (model, CRUD)

**Analog:** `lib/db/schema/team-members.ts` (check-constraint convention — this repo never uses `pgEnum`)

**Current stub** (`lib/db/schema/clients.ts`, full file, 9-18):
```typescript
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agencies } from "./agencies";

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: text("agency_id")
    .notNull()
    .references(() => agencies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

**Check-constraint pattern to copy** (`lib/db/schema/team-members.ts` lines 1-2, 24, 39-43):
```typescript
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
// ...
(table) => [
  check("team_members_role_check", sql`${table.role} in ('admin', 'member')`),
  check(
    "team_members_status_check",
    sql`${table.status} in ('invited', 'active', 'removed')`,
  ),
],
```
Apply this exact shape for `clients_industry_check` (industry is one of the 8 codes, or null) and `clients_contact_required_check` (phone or email not null) — see RESEARCH.md Pattern 1 for the full target schema (already fully written there, ready to copy verbatim).

---

### `drizzle/migrations/0020_clients_crm_fields.sql` (migration, batch)

**Analog:** `drizzle/migrations/0004_client_assignments_check.sql` (ALTER TABLE + ADD CONSTRAINT shape) and `drizzle/migrations/0008_agent_action_catalog_seed.sql` (header-comment convention)

**Structural convention to copy:** every statement group ends with `--> statement-breakpoint` (this is how the hand-rolled migration runner in `scripts/migrate.ts` splits multi-statement files — confirmed present in every migration from `0001` through `0019`). Header comment block explains *why*, matching every existing migration's opening comment style (see `0008`'s header, reproduced in RESEARCH.md).

**Required companion change:** `drizzle/migrations/meta/_journal.json` — append one `{ idx: 20, version: "7", when: <ms-epoch>, tag: "0020_clients_crm_fields", breakpoints: true }` entry (and `21`/`22` for the other two migrations). Read the last 4 entries of that file directly before writing new ones, to copy the exact key order/shape.

---

### `drizzle/migrations/0021_clients_write_by_team_member.sql` (migration, batch/RLS)

**Analog:** `drizzle/migrations/0001_rls_policies.sql`, clients section (lines 109-148)

**Exact policy being replaced** (`0001_rls_policies.sql` lines 125-148):
```sql
CREATE POLICY clients_select_by_role ON clients
  FOR SELECT
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND (
      current_setting('app.role', true) = 'admin'
      OR id IN (
        SELECT client_id FROM client_assignments
        WHERE team_member_id = current_setting('app.team_member_id', true)::uuid
      )
    )
  );
--> statement-breakpoint

CREATE POLICY clients_write_admin_only ON clients
  FOR ALL
  USING (
    agency_id = current_setting('app.agency_id', true)
    AND current_setting('app.role', true) = 'admin'
  )
  WITH CHECK (
    agency_id = current_setting('app.agency_id', true)
    AND current_setting('app.role', true) = 'admin'
  );
```
`clients_select_by_role` is untouched — do not re-issue it. Only `clients_write_admin_only` is `DROP POLICY`'d and replaced by three role-scoped policies (INSERT any team_member / UPDATE admin-or-assigned / DELETE admin-only) — the exact SQL is already fully drafted in RESEARCH.md's Pattern 2, ready to copy verbatim into this migration file.

---

### `drizzle/migrations/0022_agent_action_catalog_client.sql` (migration, batch/seed)

**Analog:** `drizzle/migrations/0008_agent_action_catalog_seed.sql` (full file, reproduced above in file classification context)

**Pattern to copy exactly:**
```sql
INSERT INTO agent_action_catalog (code, label, risk_level) VALUES
      ('create_client', 'Dar de alta un cliente nuevo', 'low'),
      ('update_client', 'Editar los datos de un cliente', 'low')
ON CONFLICT (code) DO NOTHING;
```
Follow `0008`'s header-comment convention explaining why these two are `low` risk (D-08: internal agency data, no client-facing impact, no money moved). Per RESEARCH.md's Open Question #1, `list_clients`/`get_client` also need catalog rows (read-only, but `classifyAndExecute` runs unconditionally) — seed those two as `low` as well in this same migration.

---

### `lib/clients/list-clients.ts` (service, CRUD — extend in place)

**Analog:** itself, current full file (9-20 for `listClients`, 22-37 for `listAssignedClientIds`)

**Current RLS-first header comment to preserve verbatim in spirit** (lines 9-17):
```typescript
/**
 * Every `clients` row visible to the caller. Deliberately no manual
 * role-based filtering here — Plan 01's `clients_select_by_role` RLS policy
 * already does exactly that (admin: every client in the agency; member:
 * only clients assigned to them via `client_assignments`), and duplicating
 * that logic in application code is the exact anti-pattern STACK-WEB.md §2
 * warns against: trust the database, don't re-implement its access rules
 * here where they could silently drift out of sync.
 */
export async function listClients(): Promise<ClientRow[]> {
  return withTenantContext((tx) => tx.select().from(clients).orderBy(clients.name));
}
```

**Target shape (from RESEARCH.md Code Examples, ready to adapt):**
```typescript
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
Both the `list_clients` agent tool and `client-search.tsx`'s server-side data source must call this exact function with the same `query` string param — no divergent filter logic (D-12).

---

### `lib/clients/assign-client.ts` (service, CRUD — extend in place)

**Analog:** itself, `assignClient` (lines 35-58) and `addClient` (lines 88-121)

**Admin-gated pattern to preserve for `assignClient`/`unassignClient` (do NOT reuse for self-assign):**
```typescript
export async function assignClient(
  clientId: string,
  teamMemberId: string,
): Promise<AdminActionResult> {
  const { userId, orgId } = await requireOrgContext();
  try {
    await withTenantContext(async (tx) => {
      await assertCallerIsAdmin(tx, userId);
      await tx
        .insert(clientAssignments)
        .values({ agencyId: orgId, clientId, teamMemberId })
        .onConflictDoNothing({
          target: [clientAssignments.clientId, clientAssignments.teamMemberId],
        });
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof NotAdminError) {
      return { ok: false, error: "not_admin" };
    }
    throw err;
  }
}
```
**Required extraction (RESEARCH.md Pattern 3):** factor the `.insert(clientAssignments)...onConflictDoNothing(...)` body out into an internal `insertAssignment(tx, agencyId, clientId, teamMemberId)` helper, called by `assignClient` (after `assertCallerIsAdmin`) AND directly by the new `create-client.ts` (no admin check — self-assignment on create, D-13). Do not call the exported `assignClient()` from `create-client.ts` — it would throw `NotAdminError` for every non-admin creator.

**`addClient` (lines 88-121) is the old admin-only, name-only quick-add — flagged for removal/redirect** (RESEARCH.md Pitfall 3): its validation (`name`-only) diverges from D-02 (`name` + phone-or-email) once this phase ships. The `assign-clients-form.tsx` UI (below) currently calls it directly.

---

### `lib/clients/create-client.ts` / `lib/clients/update-client.ts` (service, CRUD — new)

**Analog:** `lib/brand/update-brand-config.ts` (full file) — closest existing Server-Action-shaped validate-then-write function with a typed error union result.

**Imports + result-type pattern** (lines 1-23):
```typescript
"use server";

import { sql } from "drizzle-orm";
import { withTenantContext } from "@/lib/tenant/with-tenant-context";
import { agentBrandConfig } from "@/lib/db/schema/agent-brand-config";
import { isBrandTone } from "./tone";

export type UpdateBrandConfigInput = { agentName: string; tone: string; logoUrl: string | null };
export type UpdateBrandConfigError =
  | "agentNameRequired" | "agentNameTooLong" | "invalidTone" | "forbidden" | "unknown";
export type UpdateBrandConfigResult =
  | { success: true }
  | { success: false; error: UpdateBrandConfigError };
```

**Validation-before-write pattern** (lines 34-47):
```typescript
export async function updateBrandConfig(
  input: UpdateBrandConfigInput,
): Promise<UpdateBrandConfigResult> {
  const agentName = input.agentName.trim();
  if (agentName.length === 0) {
    return { success: false, error: "agentNameRequired" };
  }
  if (agentName.length > 60) {
    return { success: false, error: "agentNameTooLong" };
  }
  if (!isBrandTone(input.tone)) {
    return { success: false, error: "invalidTone" };
  }
  // ...
```
Adapt for `create-client.ts`: validate `name` non-empty, at least one of `phone`/`email` present (D-02), `industry` in `CLIENT_INDUSTRY_CODES` if provided. Both `create-client.ts`/`update-client.ts` must be callable from TWO entry points (web Server Action AND agent tool `execute()`), so — unlike `updateBrandConfig` — they should accept an explicit `agencyId`/`identity` (or `TurnActor`-shaped) parameter rather than reading Clerk `auth()` internally; the web Server Action wrapper (in the same file or a thin caller) resolves `auth()`, the agent tool passes `actor.agencyId`/`actor.identity` straight through — mirrors `deliverToClient`'s params shape in `lib/agent/tools/deliver-to-client.ts` (lines 28-34): `{ agencyId, clientId, identity, body }`.

**After insert, self-assign (D-13):** call the new `insertAssignment` helper from `assign-client.ts` directly, with `teamMemberId` = the creator's own team member id resolved inside the same `withTenantContext`/`withResolvedIdentityContext` transaction (via `findCallerTeamMember`, see `lib/team/current-member.ts` lines 36-46).

**Duplicate-name check (D-09):** a plain `ilike` lookup against `clients.name` scoped by the caller's own RLS-visible rows (same query shape as `listClients`'s filter), surfaced as a returned string/result field the caller (web form message or agent tool relay) can show — never a thrown error, never a blocking constraint.

---

### `lib/clients/get-client.ts` (service, CRUD single-row read — new)

**Analog:** `lib/clients/list-clients.ts`'s `listAssignedClientIds` (lines 29-37) for the single-purpose, RLS-trusting query shape:
```typescript
export async function listAssignedClientIds(teamMemberId: string): Promise<string[]> {
  return withTenantContext(async (tx) => {
    const rows = await tx
      .select({ clientId: clientAssignments.clientId })
      .from(clientAssignments)
      .where(eq(clientAssignments.teamMemberId, teamMemberId));
    return rows.map((row) => row.clientId);
  });
}
```
Adapt: `getClient(clientId: string)` does `tx.select().from(clients).where(eq(clients.id, clientId))` inside `withTenantContext`, returns the row or `null` — RLS (`clients_select_by_role`) alone decides whether the row exists in the result set; no extra `WHERE agency_id`/`role` predicate.

---

### `lib/clients/industries.ts` (config/utility — new)

**Analog:** `lib/brand/tone.ts` (bilingual-label-driven-by-code pattern) — read that file directly if further detail is needed (not read this session, but its `BRAND_TONES`/`isBrandTone` usage is visible via `brand-form.tsx` lines 5, 121-126 and `update-brand-config.ts` line 6, 44).

**Pattern to copy from usage evidence** (`brand-form.tsx` lines 5, 121-126):
```typescript
import { BRAND_TONES, type BrandConfig, type BrandTone } from "@/lib/brand/tone";
// ...
{BRAND_TONES.map((option) => (
  <option key={option} value={option}>
    {t(`tones.${option}`)}
  </option>
))}
```
Mirror exactly: export `CLIENT_INDUSTRY_CODES` (already drafted in RESEARCH.md Pattern 1 as a `const ... as const` tuple of 8 codes) and an `isClientIndustry(value: unknown): value is ClientIndustry` type guard (same shape as `isBrandTone`). Labels are NOT hardcoded here — the `<select>` component reads `t(`Clients.industries.${code}`)` via `next-intl`, per the UI-SPEC's explicit instruction (RESEARCH.md "Don't Hand-Roll" table).

---

### `lib/agent/tools/create-client.ts` / `update-client.ts` / `get-client.ts` (agent tool, event-driven — new)

**Analog:** `lib/agent/tools/draft-client-content.ts` (full file, 69 lines) — closest tool shape with manual input narrowing and a call to a shared `lib/*` write function.

**Full pattern to copy** (imports, `catalogCode`, `definition`, narrowing, `execute`):
```typescript
import type Anthropic from "@anthropic-ai/sdk";
import type { TurnActor } from "@/lib/agent/types";
import { deliverToClient } from "./deliver-to-client";

export const catalogCode = "new_client_content";

export const definition: Anthropic.Messages.Tool = {
  name: "draft_client_content",
  description: "...",
  input_schema: {
    type: "object",
    properties: {
      clientId: { type: "string", description: "UUID del cliente" },
      contentDraft: { type: "string", description: "Contenido a enviar al cliente" },
    },
    required: ["clientId", "contentDraft"],
  },
};

type DraftClientContentInput = { clientId: string; contentDraft: string };

// Hand-written narrowing, no runtime schema-validation dependency — repo
// posture (see parse-webhook-payload.ts's own header comment).
function isValidInput(input: unknown): input is DraftClientContentInput {
  if (typeof input !== "object" || input === null) return false;
  const record = input as Record<string, unknown>;
  return typeof record.clientId === "string" && typeof record.contentDraft === "string";
}

export async function execute(input: unknown, actor: TurnActor): Promise<string> {
  if (!isValidInput(input)) {
    return "Entrada inválida: se requieren clientId y contentDraft.";
  }
  const result = await deliverToClient({ agencyId: actor.agencyId, clientId: input.clientId, identity: actor.identity, body: input.contentDraft });
  if (result.delivered) {
    return `Contenido enviado al cliente ${input.clientId} (WhatsApp ${result.metaMessageId}).`;
  }
  return `No se pudo enviar el contenido: ${result.reason}`;
}
```
`create_client`'s full target shape is already drafted in RESEARCH.md Pattern 4 (copy verbatim, including the D-07 "ask back if missing contact" and D-09 duplicate-name-confirmation-as-returned-string behavior). `update_client`/`get_client` follow the identical shape, swapping the call target to `updateClient`/`getClient`.

**CRITICAL — use `withResolvedIdentityContext`, never `withTenantContext`, inside tool `execute()`** (RESEARCH.md Pitfall 5): `deliver-to-client.ts` line 46 shows the correct helper (`withResolvedIdentityContext(agencyId, identity, ...)`); `withTenantContext` is Clerk-session-based and will crash any WhatsApp-only code path or `tsx` verification script.

---

### `lib/agent/tools/list-clients.ts` (agent tool, event-driven — new, no clientId)

**Analog:** `lib/agent/tools/send-payment-reminder.ts` for the tool-file shape, combined with the extended `listClients(query?)` for the actual query.

**Adapt the `definition`/narrowing shape** (send-payment-reminder.ts lines 13-40), dropping the `clientId` field entirely from `input_schema` — RESEARCH.md's Anti-Patterns explicitly forbids adding a fake `clientId` just to satisfy the (soon-to-be-fixed) interceptor:
```typescript
export const definition: Anthropic.Messages.Tool = {
  name: "list_clients",
  description: "Busca clientes por nombre, industria o notas. Devuelve solo los clientes visibles para quien pregunta.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Texto a buscar (nombre, industria o notas). Opcional — vacío lista todos los visibles." },
    },
    required: [],
  },
};
```
`execute()` calls `listClients(query)` inside `withResolvedIdentityContext`, formats the rows into a short text list for the model to relay (name + industry + phone/email, per D-11's "same access as the human's role" principle — no re-filtering).

---

### `lib/agent/tools/index.ts` (registry — extend in place)

**Analog:** itself, full current file (24 lines)

**Current registry pattern to extend** (lines 1-24):
```typescript
import type Anthropic from "@anthropic-ai/sdk";
import type { TurnActor } from "@/lib/agent/types";
import type { ResolvedIdentity } from "@/lib/identity/types";
import * as draftClientContent from "./draft-client-content";
import * as sendPaymentReminder from "./send-payment-reminder";

type AgentTool = {
  definition: Anthropic.Messages.Tool;
  catalogCode: string;
  execute: (input: unknown, actor: TurnActor) => Promise<string>;
};

export const AGENT_TOOLS: readonly AgentTool[] = [
  sendPaymentReminder,
  draftClientContent,
] as const;
```
Add four more `import * as ... from "./create-client"` etc. and append to the `AGENT_TOOLS` array. `toolsFor()`/`executeTool()` (lines 33-55) need NO changes — both already iterate over `AGENT_TOOLS` generically.

---

### `lib/agent/risk-interceptor.ts` (middleware — extend in place)

**Analog:** itself, full current file (256 lines) — the single SEG-10 gate every tool call passes through.

**`TOOL_TO_CATALOG_CODE` map to extend** (lines 25-28):
```typescript
export const TOOL_TO_CATALOG_CODE: Record<string, string> = {
  send_payment_reminder: "payment_reminder",
  draft_client_content: "new_client_content",
};
```
Add `create_client: "create_client"`, `update_client: "update_client"`, `list_clients: "list_clients"`, `get_client: "get_client"`.

**Conditional clientId requirement (REQUIRED FIX — RESEARCH.md Pitfall 2)**, extending the current unconditional block (lines 88-121):
```typescript
const clientId = extractClientId(toolUse.input);
if (clientId === null || !UUID_REGEX.test(clientId)) {
  return rejectResult(toolUse.id, "El argumento clientId no es un identificador válido.");
}
if (actor.identity.type === "client_contact" && clientId !== actor.identity.clientId) {
  return rejectResult(toolUse.id, "No autorizado: este contacto no puede actuar sobre otro cliente.");
}
if (actor.identity.type === "unknown") {
  return rejectResult(toolUse.id, "No autorizado: un remitente no identificado no puede ejecutar acciones.");
}
```
Wrap this whole block in `if (CLIENT_SCOPED_TOOLS.has(toolUse.name)) { ... }` (per RESEARCH.md's exact recommended fix: `const CLIENT_SCOPED_TOOLS = new Set(["send_payment_reminder", "draft_client_content", "update_client", "get_client"])`) — `create_client`/`list_clients` skip straight to classification with `clientId = null`. Everything downstream (`writeAuditLog({ clientId, ... })`, lines 143-249) already accepts `clientId: string | null` — no further change needed there.

**Low-risk auto-execute branch to reuse as-is** (lines 157-191) — `create_client`/`update_client`/`list_clients`/`get_client` all classify `low` per migration `0022`, so they all take this exact branch, unmodified.

---

### `lib/audit/list-audit-log.ts` (service — extend in place)

**Analog:** itself, `listRecentConversationMessages` (lines 85-102), extend with a client-scoped sibling.

**Function to copy and adapt** (lines 85-102, full body):
```typescript
export async function listRecentConversationMessages(limit = 100): Promise<ConversationEntry[]> {
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
      .orderBy(desc(messages.createdAt))
      .limit(limit),
  );
}
```
New `listConversationMessagesForClient(clientId: string, limit = 100)` adds exactly one predicate: `.where(eq(messages.clientId, clientId))` — no other change, no new role/scope logic (RLS's `messages_select_by_role` already governs visibility, per the file's own header comment at lines 9-29, which must be preserved/extended, not rewritten).

---

### `app/[locale]/dashboard/clients/page.tsx` (route, request-response — new)

**Analog:** `app/[locale]/dashboard/bitacora/page.tsx` (full file, 117 lines) — multi-section SSR Server Component with a "provisioning" guard.

**Provisioning guard + parallel data fetch pattern** (lines 28-50):
```typescript
export default async function BitacoraPage() {
  const [t, locale, currentMember] = await Promise.all([
    getTranslations("Bitacora"),
    getLocale(),
    getCurrentTeamMember(),
  ]);

  if (!currentMember) {
    const tTeam = await getTranslations("Team");
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {tTeam("provisioning")}
      </div>
    );
  }

  const [pendingApprovals, auditEntries, conversationMessages] = await Promise.all([
    listPendingApprovals(),
    listAuditLog(),
    listRecentConversationMessages(),
  ]);
  // ...
```
Adapt: fetch `searchParams` for the `?q=` filter (Next.js `params`/`searchParams` promise convention — same file's `params: Promise<{ locale }>` pattern used in `team/[memberId]/page.tsx` lines 15-20), call `listClients(q)`, render `<ClientSearch />` + `<ClientList clients={...} />`.

---

### `app/[locale]/dashboard/clients/client-list.tsx` (component, Server Component — new)

**Analog:** `app/[locale]/dashboard/bitacora/audit-list.tsx` (full file, 59 lines) — plain async Server Component rendering a translated `<ul>`.

**Pattern to copy** (lines 17-28):
```typescript
export async function AuditList({ entries }: { entries: AuditEntry[] }) {
  const [t, locale] = await Promise.all([getTranslations("Bitacora"), getLocale()]);
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-2 py-3">
          {/* ... */}
        </li>
      ))}
    </ul>
  );
}
```
Same shape for `ClientList`: `<ul>` of `<li>` rows, each linking to `/dashboard/clients/[clientId]` (per UI-SPEC's "no modals, dedicated routes" convention cited in RESEARCH.md).

---

### `app/[locale]/dashboard/clients/client-form.tsx` (component, "use client" shared create/edit — new)

**Analog:** `app/[locale]/dashboard/settings/brand/brand-form.tsx` (full file, 179 lines) — closest existing controlled-form-with-Server-Action-submit pattern.

**Imports + state + submit pattern** (lines 1-6, 73-84):
```typescript
"use client";

import { useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { BRAND_TONES, type BrandConfig, type BrandTone } from "@/lib/brand/tone";
import { updateBrandConfig } from "@/lib/brand/update-brand-config";

// ...

function handleSubmit(event: FormEvent) {
  event.preventDefault();
  setMessage(null);
  startTransition(async () => {
    const result = await updateBrandConfig({ agentName, tone, logoUrl });
    if (result.success) {
      setMessage({ kind: "success", text: t("saveSuccess") });
    } else {
      setMessage({ kind: "error", text: t(`errors.${result.error}`) });
    }
  });
}
```
**Form field pattern** (lines 96-127, `<input>`/`<select>` with label, using `t()` for every string):
```typescript
<div className="flex flex-col gap-1">
  <label htmlFor="agentName" className="text-sm font-medium">{t("agentNameLabel")}</label>
  <input
    id="agentName"
    value={agentName}
    onChange={(e) => setAgentName(e.target.value)}
    placeholder={t("agentNamePlaceholder")}
    maxLength={60}
    className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
  />
</div>
<div className="flex flex-col gap-1">
  <label htmlFor="tone" className="text-sm font-medium">{t("toneLabel")}</label>
  <select id="tone" value={tone} onChange={(e) => setTone(e.target.value as BrandTone)} className="...">
    {BRAND_TONES.map((option) => (
      <option key={option} value={option}>{t(`tones.${option}`)}</option>
    ))}
  </select>
</div>
```
Adapt for `ClientForm`: fields `name`, `phone`, `email`, `industry` (`<select>` using `CLIENT_INDUSTRY_CODES`/`t(\`Clients.industries.${code}\`)`), `notes` (`<textarea>`). Accepts an optional `initialValues: ClientRow` prop to distinguish create vs. edit (same `initialValues`-prop convention `BrandForm` already uses, line 10). Submit calls `createClient(...)` or `updateClient(...)` depending on mode, mirroring `updateBrandConfig`'s `{ success, error }` result-union handling exactly.

---

### `app/[locale]/dashboard/clients/[clientId]/conversation-history.tsx` (component, read-only — new)

**Analog:** `app/[locale]/dashboard/bitacora/page.tsx`'s conversation section (lines 90-113) — inline `<ul>` block, extract to its own component for the ficha.

**Pattern to copy:**
```typescript
<ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
  {conversationMessages.map((message) => (
    <li key={message.id} className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
        <span>{timestampFormatter.format(message.createdAt)}</span>
        <span>{message.channel}</span>
        <span>{t(`direction.${message.direction}`)}</span>
      </div>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">{truncate(message.textBody)}</p>
    </li>
  ))}
</ul>
```
Data source swaps to `listConversationMessagesForClient(clientId)`; the `clientName` column becomes redundant (already scoped to one client) and can be dropped from the projection. `truncate()` helper (page.tsx lines 10-15) is worth copying verbatim if long message bodies need clamping on the ficha.

---

### `app/[locale]/dashboard/clients/[clientId]/assignment-panel.tsx` (component, "use client" — new)

**Analog:** `app/[locale]/dashboard/team/[memberId]/assign-clients-form.tsx` (full file, 148 lines) — optimistic-toggle-with-rollback pattern, admin-gated.

**Optimistic toggle pattern to copy** (lines 34-71):
```typescript
async function toggle(clientId: string) {
  const wasAssigned = assignedIds.has(clientId);
  setError(null);
  setPendingIds((current) => new Set(current).add(clientId));
  setAssignedIds((current) => {
    const next = new Set(current);
    if (wasAssigned) next.delete(clientId); else next.add(clientId);
    return next;
  });

  const result = wasAssigned
    ? await unassignClient(clientId, teamMemberId)
    : await assignClient(clientId, teamMemberId);

  setPendingIds((current) => { const next = new Set(current); next.delete(clientId); return next; });

  if (!result.ok) {
    setAssignedIds((current) => {
      const next = new Set(current);
      if (wasAssigned) next.add(clientId); else next.delete(clientId);
      return next;
    });
    setError(t("errors.notAdmin"));
  }
}
```
Inverted axis for the ficha (D-16): instead of "one team member × many clients" (toggle grid), it's "one client × many team members" — same `assignClient`/`unassignClient` calls, same optimistic-rollback shape, just iterate over team members instead of clients. Reuse `assign-client.ts` verbatim (no new Server Action needed) — only the calling component's iteration axis changes.

**Companion route:** `app/[locale]/dashboard/team/[memberId]/page.tsx` shows how the parent Server Component fetches admin-gated data before rendering the panel (lines 15-41, `redirect` + `Promise.all` pattern) — the ficha's `page.tsx` follows the same shape but does NOT redirect non-admins away from the whole ficha (only the reassignment control itself should be conditionally rendered per D-16 "solo admin", the rest of the ficha is visible to any team member per their RLS scope).

---

### `app/[locale]/dashboard/team/[memberId]/assign-clients-form.tsx` (MOD — remove/redirect quick-add)

**Current lines to remove or repoint** (lines 73-91, 95-117 — the `handleAddClient` form and its JSX):
```typescript
async function handleAddClient(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const trimmed = newClientName.trim();
  if (!trimmed) return;
  setIsAddingClient(true);
  setError(null);
  const result = await addClient(trimmed);
  // ...
}
```
Per RESEARCH.md Pitfall 3 (recommended default: remove), delete this handler and its `<form>` block (lines 95-117), and instead render a link/button to `/dashboard/clients/new`. This keeps exactly one client-creation path with exactly one validation rule (D-02), consistent with this codebase's demonstrated aversion to drift (see `list-clients.ts`'s own anti-duplication comment).

---

### `messages/es.json` / `messages/en.json` (i18n — new `Clients` namespace)

**Analog:** `Team`/`Bitacora` namespace shape (`messages/es.json` lines 26-89ish — full namespace blocks with nested `errors`, per-status/per-risk sub-keys).

**Nesting pattern to copy** (`Bitacora`-style status/risk sub-objects, inferred from `audit-list.tsx` lines 4-15 usage `t(\`risk.${entry.riskLevel}\`)`/`t(\`status.${entry.status}\`)`):
```json
"Clients": {
  "title": "Clientes",
  "subtitle": "...",
  "searchPlaceholder": "...",
  "newClient": "...",
  "industries": {
    "restaurants_food": "Restaurantes/gastronomía",
    "health_beauty": "Salud/estética",
    "fashion_retail": "Moda/retail",
    "professional_services": "Servicios profesionales",
    "real_estate": "Inmobiliaria",
    "fitness_sports": "Fitness/deporte",
    "education": "Educación",
    "other": "Otro"
  },
  "errors": { "nameRequired": "...", "contactRequired": "..." }
}
```
Mirror the exact key set into `en.json` with English strings — `Clients.industries.<code>` is read via `next-intl`'s `t()` from the `<select>`/ficha label per D-04/UI-SPEC's explicit instruction, never a hardcoded ES/EN string in the option list.

## Shared Patterns

### Tenant/Identity context (the two GUC-setting helpers — never mix them up)
**Source A:** `lib/tenant/with-tenant-context.ts` (full file) — Clerk-session-based, `server-only`. Use in: web Server Actions (`create-client.ts`'s web-form entry, `update-client.ts`'s web-form entry), all `page.tsx` Server Components.
**Source B:** `lib/tenant/with-resolved-identity-context.ts` (full file) — identity-resolved-from-phone-number-based, NOT `server-only`. Use in: every agent tool's `execute()` (`create-client.ts`/`update-client.ts`/`list-clients.ts`/`get-client.ts` under `lib/agent/tools/`), exactly like `deliver-to-client.ts` line 46 already does.
**Apply to:** every new file under `lib/clients/*.ts` and `lib/agent/tools/*.ts` this phase.

### RLS-first, no app-layer role filter
**Source:** `lib/clients/list-clients.ts` lines 9-17 (header comment) + `lib/audit/list-audit-log.ts` lines 14-19 (LD-17 comment).
**Apply to:** `listClients`, `getClient`, `listConversationMessagesForClient` — none of these may add a `WHERE agency_id`/`WHERE role` predicate of their own. Scope is exclusively `clients_select_by_role`/`messages_select_by_role`.

### Admin-only re-check pattern (`assertCallerIsAdmin`)
**Source:** `lib/team/current-member.ts` lines 63-72, used by `lib/clients/assign-client.ts` lines 43, 69, 108.
**Apply to:** `assignClient`/`unassignClient` (reassignment on the ficha, D-16) — do NOT apply to the new self-assign-on-create helper (`insertAssignment`), that is the one deliberate exception.

### Hand-written input narrowing for agent tools (no zod)
**Source:** `lib/agent/tools/draft-client-content.ts` lines 37-46 (comment + `isValidInput` function), repeated verbatim in `send-payment-reminder.ts` lines 32-40.
**Apply to:** all four new agent tool files. Explicit repo posture — do not introduce a validation library.

### Server Action validate-then-write with typed error union
**Source:** `lib/brand/update-brand-config.ts` full file (93 lines).
**Apply to:** `lib/clients/create-client.ts`, `lib/clients/update-client.ts` — same `{ success: true } | { success: false; error: SpecificErrorCode }` result shape, same trim-and-length-check validation-before-transaction pattern.

### Optimistic client-side toggle with server rollback
**Source:** `app/[locale]/dashboard/team/[memberId]/assign-clients-form.tsx` lines 34-71.
**Apply to:** `assignment-panel.tsx` on the client ficha (D-16).

### i18n: every string via `next-intl`'s `t()`, never hardcoded Spanish/English in JSX
**Source:** every component read this session (`audit-list.tsx`, `brand-form.tsx`, `assign-clients-form.tsx`) — confirmed zero hardcoded UI strings.
**Apply to:** every new component under `app/[locale]/dashboard/clients/`.

### Migration file structure: header comment + `--> statement-breakpoint` + hand-updated `_journal.json`
**Source:** every file in `drizzle/migrations/0001` through `0019`, most directly `0001_rls_policies.sql` and `0008_agent_action_catalog_seed.sql`.
**Apply to:** `0020_clients_crm_fields.sql`, `0021_clients_write_by_team_member.sql`, `0022_agent_action_catalog_client.sql`, and the corresponding `meta/_journal.json` append (idx 20/21/22).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `app/[locale]/dashboard/clients/client-search.tsx` | component ("use client") | request-response (debounced URL param sync) | No existing debounced-search-by-URL-param component in this codebase (confirmed via grep — no `lodash`/`use-debounce` dependency). Planner/coder should use a small local `useEffect` + `setTimeout` per RESEARCH.md's "Don't Hand-Roll" table; `useRouter`/`usePathname`/`useSearchParams` from `next/navigation` (or this repo's `@/i18n/navigation` wrapper, used by `assign-clients-form.tsx` line 5) is the closest structural precedent for URL-driven state, but the debounce itself is new. |
| `lib/agent/tools/list-clients.ts`'s "agency-scoped, no single clientId" tool shape | service (agent tool) | event-driven | Both existing tools (`send_payment_reminder`, `draft_client_content`) are client-scoped by construction; `list_clients` is the first agency-wide read-only tool. `send-payment-reminder.ts` supplies the file shape (definition/narrowing/execute), but the "no clientId, no client-scope cross-check" behavior itself has zero precedent — governed entirely by the `risk-interceptor.ts` fix (Pitfall 2) documented above, not by copying an existing tool's logic. |

## Metadata

**Analog search scope:** `lib/db/schema/`, `lib/clients/`, `lib/agent/tools/`, `lib/agent/risk-interceptor.ts`, `lib/audit/`, `lib/brand/`, `lib/team/`, `lib/tenant/`, `app/[locale]/dashboard/{bitacora,chat,settings/brand,team}/`, `drizzle/migrations/`, `messages/es.json`
**Files scanned:** ~30 (all read directly this session; no analog claimed without a direct read)
**Pattern extraction date:** 2026-09-14
