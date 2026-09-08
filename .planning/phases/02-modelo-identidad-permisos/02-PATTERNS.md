# Phase 2: Modelo de identidad y permisos - Pattern Map

**Mapped:** 2026-09-08
**Files analyzed:** 15
**Analogs found:** 15 / 15 (all have at least a role-match; 3 flagged as "new shape, adapt don't copy verbatim" in Pattern Assignments)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `lib/db/schema/authorized-contacts.ts` | model (Drizzle table) | CRUD | `lib/db/schema/team-members.ts` | exact (same shape: tenant-scoped table, uniqueIndex, check constraints) |
| `lib/db/schema/agent-action-catalog.ts` | model (Drizzle table, global/static) | CRUD (read-mostly, seeded) | `lib/db/schema/agencies.ts` | role-match (simple pgTable, no FK to agency, enum-ish status field) |
| `lib/db/schema/audit-log.ts` | model (Drizzle table, schema-only) | event-driven (schema shell only, D-01) | `lib/db/schema/client-assignments.ts` | role-match (tenant-scoped child table with FKs, no business logic yet) |
| `lib/db/schema/index.ts` (modified) | config (barrel export) | — | `lib/db/schema/index.ts` (itself, current state) | exact — additive edit only |
| `drizzle/migrations/000X_authorized_contacts.sql` | migration | CRUD (DDL: table + RLS + unique index + CHECK) | `drizzle/migrations/0001_rls_policies.sql` + `0004_client_assignments_check.sql` | exact (RLS idiom) + exact (trigger idiom) |
| `drizzle/migrations/000X_client_contact_rls_scope.sql` | migration | request-response (RLS policy read-path) | `drizzle/migrations/0002_fix_clients_rls_uuid_cast.sql` | exact — same `clients_select_by_role` policy being extended, same `NULLIF` idiom required |
| `drizzle/migrations/000X_agent_action_catalog.sql` | migration | batch (DDL + static seed rows) | `drizzle/migrations/0000_initial_schema.sql` (DDL shape) | role-match (no seed-data precedent exists yet — new sub-pattern) |
| `drizzle/migrations/000X_audit_log.sql` | migration | CRUD (DDL: tenant-scoped table + RLS) | `drizzle/migrations/0001_rls_policies.sql` (per-table RLS block) | exact |
| `lib/identity/types.ts` | model (TS discriminated union) | transform | *(no existing analog — new shape)* | none — RESEARCH.md Code Examples section is the source |
| `lib/identity/classify-identity.ts` | service (pure function) | transform | `lib/team/current-member.ts` (`findCallerTeamMember`/`assertCallerIsAdmin` — pure-logic-over-already-fetched-row style) | role-match |
| `lib/identity/resolve-identity.ts` | service (DB orchestration) | request-response | `lib/tenant/with-tenant-context.ts` (lookup-before-GUC shape) | exact (same two-step "set what you can, look up, set the rest" pattern) |
| `lib/tenant/with-resolved-identity-context.ts` | middleware/provider (GUC-setting transaction) | request-response | `lib/tenant/with-tenant-context.ts` | exact — direct structural parallel |
| `lib/clients/manage-authorized-contacts.ts` | controller (Server Action) | CRUD | `lib/clients/assign-client.ts` (admin-only mutation pair) + `lib/team/invite-member.ts` (validation + structured result) | exact |
| `scripts/verify-identity-classification.ts` | test (unit, no DB) | transform | *(no existing analog — new shape: first network-free test script)* | none — follows `check()`/assertion helper style of `verify-rls-isolation.ts` but without `db` |
| `scripts/verify-identity-resolution.ts` | test (integration, real Neon) | request-response | `scripts/verify-rls-isolation.ts` | exact |

## Pattern Assignments

### `lib/db/schema/authorized-contacts.ts` (model, CRUD)

**Analog:** `lib/db/schema/team-members.ts` (full file, 35 lines)

**Imports pattern:**
```typescript
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencies } from "./agencies";
import { clients } from "./clients";
```

**Core table-definition pattern** (mirrors `team-members.ts` lines 5-35 structurally):
```typescript
export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: text("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    // ...
  },
  (table) => [
    uniqueIndex("team_members_agency_id_email_idx").on(table.agencyId, table.email),
    check("team_members_role_check", sql`${table.role} in ('admin', 'member')`),
    check("team_members_status_check", sql`${table.status} in ('invited', 'active', 'removed')`),
  ],
);
```
Apply the identical shape for `authorized_contacts`: `id uuid`, `agencyId text` (FK to `agencies`, cascade), `clientId uuid` (FK to `clients`, cascade — new column team-members.ts doesn't have, but same style as `clientAssignments.clientId` in `client-assignments.ts` lines 13-15), `name text`, `phoneNumber text`, `email text` (nullable per D-05 "campos mínimos"), `contactRole text` (the contact's role at the client, e.g. "dueño"), `optInConfirmedByTeam boolean` (see Pitfall 3 naming note — do NOT call it bare `opt_in_confirmed`), `optInConfirmedBy uuid` (FK to `team_members`), `optInConfirmedAt timestamp`, `createdAt timestamp`.

**Uniqueness constraint (D-08 — one phone number, one client):**
```typescript
// Source: lib/db/schema/team-members.ts line 25-28
uniqueIndex("team_members_agency_id_email_idx").on(table.agencyId, table.email),
```
Apply as `uniqueIndex("authorized_contacts_agency_id_phone_idx").on(table.agencyId, table.phoneNumber)` — note D-08 says "vinculado a un segundo **cliente**" is blocked, and phone must be globally unique to one client within the agency, so the unique index should be on `(agencyId, phoneNumber)` (not `(clientId, phoneNumber)`), matching SEG-02's "un número de teléfono está vinculado a un único cliente" at the agency level.

**Check constraint pattern** (opt-in consistency, D-03's "se guarda quién confirmó y cuándo" as an invariant):
```typescript
// Source: lib/db/schema/team-members.ts line 29-33
check("team_members_role_check", sql`${table.role} in ('admin', 'member')`),
```
Apply as a CHECK tying `opt_in_confirmed_by_team = true` to both `opt_in_confirmed_by IS NOT NULL` and `opt_in_confirmed_at IS NOT NULL` (SEG-04's test map row) — same `check(name, sql\`...\`)` call shape, just a boolean-implication expression instead of an `IN (...)` list.

---

### `lib/db/schema/agent-action-catalog.ts` (model, global/static, no RLS)

**Analog:** `lib/db/schema/agencies.ts` (full file, 21 lines) — closest shape for "simple pgTable, no `agencyId` FK, has a `status`/enum-like text column with a code comment explaining lifecycle."

**Core pattern:**
```typescript
// Source: lib/db/schema/agencies.ts lines 9-21
export const agencies = pgTable("agencies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("trial"),
  // ...
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```
Apply for `agent_action_catalog`: `code text` primary key (e.g. `'payment_reminder'`, `'reschedule_appointment'`, `'new_client_content'` — D-02's three seeded examples), `label text`, `riskLevel text` with a `check()` constraint (reuse `team-members.ts` line 29 idiom: `sql\`${table.riskLevel} in ('low', 'high')\``), `createdAt timestamp`. **No `agencyId` column, no RLS** (per RESEARCH.md Assumption A3 and Architecture Responsibility Map row "Action-type risk catalog... Global, not tenant-scoped").

**Seed data pattern:** No existing precedent in this codebase for seeding rows via a migration (0000-0004 are pure DDL). This is a genuinely new sub-pattern — write plain `INSERT INTO agent_action_catalog (code, label, risk_level) VALUES (...)` statements at the bottom of the migration file, following the same `--> statement-breakpoint` separator convention visible in every existing migration (e.g. `0000_initial_schema.sql` lines 1-30, `0004_client_assignments_check.sql` lines 22-51).

---

### `lib/db/schema/audit-log.ts` (model, schema-only, D-01)

**Analog:** `lib/db/schema/client-assignments.ts` (full file, 30 lines) — closest shape for "tenant-scoped child table with multiple FKs and a unique index, no business-logic file alongside it yet."

**Core pattern:**
```typescript
// Source: lib/db/schema/client-assignments.ts lines 6-29
export const clientAssignments = pgTable(
  "client_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: text("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    teamMemberId: uuid("team_member_id").notNull().references(() => teamMembers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [ /* uniqueIndex(...) */ ],
);
```
Apply for `audit_log` per RESEARCH.md's Assumption A4 shape: `id uuid`, `agencyId text` (FK to `agencies`, cascade — NOT nullable), `clientId uuid` (FK to `clients`, **nullable** — some future logged actions may be agency-internal, not client-scoped), `actionTypeCode text` (FK to `agent_action_catalog.code`), `riskLevel text` (a snapshot copy at time of logging, per A4 — not a live join, so historical rows don't change if the catalog's risk_level is edited later), `summary text`, `createdAt timestamp`. No unique index needed (append-only log). D-01: schema shell only, no server action/insert logic this phase.

**RLS for audit_log:** standard tenant isolation, identical to every other agency-scoped table:
```sql
-- Source: drizzle/migrations/0001_rls_policies.sql lines 87-94 (client_assignments block, same shape)
ALTER TABLE client_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY client_assignments_tenant_isolation ON client_assignments
  USING (agency_id = current_setting('app.agency_id', true))
  WITH CHECK (agency_id = current_setting('app.agency_id', true));
```
Copy this block verbatim, renaming to `audit_log`/`audit_log_tenant_isolation`. Also add `audit_log` to the `GRANT SELECT, INSERT, UPDATE, DELETE ON ... TO app_user` list (0001 line 54-56 pattern) in whichever migration first creates the table.

---

### `lib/db/schema/index.ts` (config, barrel export — modified)

**Current full file (4 lines to extend):**
```typescript
export * from "./agencies";
export * from "./team-members";
export * from "./clients";
export * from "./client-assignments";
export * from "./agent-brand-config";
```
Add three lines: `export * from "./authorized-contacts";`, `export * from "./agent-action-catalog";`, `export * from "./audit-log";` — same flat one-line-per-table convention, no grouping/reordering.

---

### `drizzle/migrations/000X_authorized_contacts.sql` (migration)

**Analog 1 — RLS + FORCE + role-aware SELECT/write split:** `drizzle/migrations/0001_rls_policies.sql` lines 109-149 (`clients` block — closest existing "role-gated read, admin-only write" shape, though per D-09/D-10 `authorized_contacts` SELECT is agency-wide, not role-split, so only the `clients_write_admin_only` half (lines 139-148) is directly reusable):
```sql
-- Source: drizzle/migrations/0001_rls_policies.sql lines 139-148
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
Per D-09/D-10: `authorized_contacts` SELECT should instead mirror `team_members_tenant_isolation`'s plain agency-only policy (0001 lines 80-83, `USING (agency_id = current_setting('app.agency_id', true))`, no role branch), and INSERT/UPDATE/DELETE should mirror the `clients_write_admin_only` shape above (admin-only, per D-10 and RESEARCH.md's Open Question #2 recommendation). Two separate policies (`FOR SELECT` agency-wide, `FOR ALL` or `FOR INSERT, UPDATE, DELETE` admin-only), same "deliberately not one combined ALL policy" reasoning documented in 0001's own comment (lines 109-118).

**Analog 2 — cross-table consistency trigger (Pitfall 1: same phone in both `team_members` and `authorized_contacts`):** `drizzle/migrations/0004_client_assignments_check.sql` (full file, 52 lines):
```sql
-- Source: drizzle/migrations/0004_client_assignments_check.sql lines 22-51
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

CREATE TRIGGER client_assignments_agency_consistency_trigger
  BEFORE INSERT OR UPDATE ON client_assignments
  FOR EACH ROW
  EXECUTE FUNCTION client_assignments_agency_consistency();
```
Adapt this exact shape for a new trigger function (e.g. `authorized_contacts_no_team_member_collision`) that raises if `NEW.phone_number` already exists in `team_members.whatsapp_number` for the same `agency_id` — same "Postgres CHECK constraints cannot reference other tables, so this needs a trigger" reasoning (0004 lines 15-16). This directly implements D-08's "constraint único... más un mensaje que indique a qué otro cliente ya pertenece ese número" and RESEARCH.md's Pitfall 1.

**GRANT pattern to extend:**
```sql
-- Source: drizzle/migrations/0001_rls_policies.sql lines 54-56
GRANT SELECT, INSERT, UPDATE, DELETE ON
  agencies, team_members, clients, client_assignments, agent_brand_config
  TO app_user;
```
Add `authorized_contacts` (and later `agent_action_catalog`, `audit_log`) to an equivalent `GRANT` statement in the migration that creates each table — `app_user` has no default privileges, every new table needs an explicit grant or every query will fail with a permissions error, not merely be RLS-filtered.

---

### `drizzle/migrations/000X_client_contact_rls_scope.sql` (migration, extends `clients_select_by_role`)

**Analog:** `drizzle/migrations/0002_fix_clients_rls_uuid_cast.sql` (full file, 40 lines) — this IS the precedent for "drop and recreate `clients_select_by_role` with one more branch," including the exact `NULLIF` idiom the new `app.client_id` branch must also use:
```sql
-- Source: drizzle/migrations/0002_fix_clients_rls_uuid_cast.sql lines 25-39
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
    )
  );
```
Add the third branch (per RESEARCH.md Architecture Pattern 3, already drafted there):
```sql
      OR (
        current_setting('app.role', true) = 'client_contact'
        AND id = NULLIF(current_setting('app.client_id', true), '')::uuid
      )
```
**Critical:** the new `app.client_id` GUC MUST use the same `NULLIF(current_setting(...), '')::uuid` cast as `app.team_member_id` above — never a bare `::uuid` cast (Pitfall 2 / 0002's entire raison d'être). Copy 0002's in-file comment style (lines 1-23) explaining *why*, not just *what*, for this new branch too — this is the exact convention `with-tenant-context.ts` and every migration file already follow.

---

### `lib/identity/types.ts` (model, TS discriminated union)

**No direct existing analog** — this is a new shape not present in the codebase yet. Use RESEARCH.md's own drafted contract as the concrete starting point (already validated against D-07):
```typescript
export type ResolvedIdentity =
  | { type: "team_member"; teamMemberId: string; role: "admin" | "member" }
  | { type: "client_contact"; contactId: string; clientId: string; optInConfirmed: boolean }
  | { type: "unknown" };
```
Style precedent for discriminated-union result types in this codebase: `InviteMemberResult` in `lib/team/invite-member.ts` lines 22-33 (`{ ok: true; ... } | { ok: false; error: "..." | "..." }`) — same "narrow string-literal discriminant, no class hierarchy" convention, applied here to `type` instead of `ok`.

---

### `lib/identity/classify-identity.ts` (service, pure function)

**Analog (style, not structure):** `lib/team/current-member.ts` lines 36-46 (`findCallerTeamMember`) — closest existing precedent for "a small function that turns an already-fetched row shape into a typed result, with a comment explaining exactly what it does and does NOT re-check":
```typescript
// Source: lib/team/current-member.ts lines 36-46
export async function findCallerTeamMember(
  tx: TenantTx,
  clerkUserId: string,
): Promise<CurrentTeamMember | null> {
  const [row] = await tx
    .select({ id: teamMembers.id, role: teamMembers.role, status: teamMembers.status })
    .from(teamMembers)
    .where(eq(teamMembers.clerkUserId, clerkUserId));
  return row ? { id: row.id, role: row.role as "admin" | "member", status: row.status } : null;
}
```
`classifyIdentity` should follow the same "narrow, well-commented, one job" spirit but with the I/O removed entirely (per D-07 and RESEARCH.md Pattern 2) — takes already-fetched `teamMemberRow | null` and `contactRow | null`, returns `ResolvedIdentity`, zero `await`, zero imports from `drizzle-orm` or `lib/tenant/*`. Use the exact implementation RESEARCH.md already drafted (lines 301-312 of 02-RESEARCH.md) as the concrete starting code.

---

### `lib/identity/resolve-identity.ts` (service, DB orchestration)

**Analog:** `lib/tenant/with-tenant-context.ts` (full file, 94 lines) — this is the direct structural parent. Reuse its exact "set what you know first, look up, then know more" transaction shape:
```typescript
// Source: lib/tenant/with-tenant-context.ts lines 65-93
export async function withTenantContext<T>(
  fn: (tx: Parameters<Parameters<typeof tenantDb.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    throw new NoTenantContextError();
  }
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
`resolveIdentity(agencyId, phoneNumber)` differs in one key way: it does NOT call `auth()` (per D-06 — no Clerk session assumed) and receives `agencyId` as an explicit parameter (per D-07's note). It sets `app.agency_id` first (same statement shape), queries `team_members` by `(agencyId, whatsappNumber)` instead of `(agencyId, clerkUserId)`, and if no match, queries `authorized_contacts` (D-06's fallback, RESEARCH.md Pattern 1). It then calls the pure `classifyIdentity(memberRow, contactRow)` and returns its result — it does NOT itself call `set_config` for the resolved identity's remaining GUCs (`app.team_member_id`/`app.role`/`app.client_id`); that responsibility belongs to `withResolvedIdentityContext` below, keeping `resolveIdentity` a read-only lookup. Driver note (RESEARCH.md Open Question #3, already answered): use the same `neon-serverless` `Pool`/`drizzle()` singleton pattern as `with-tenant-context.ts` lines 58-63, never the `neon-http` `db` export from `lib/db/index.ts`.

---

### `lib/tenant/with-resolved-identity-context.ts` (middleware/provider, GUC-setting transaction)

**Analog:** `lib/tenant/with-tenant-context.ts` (full file) — direct parallel, same file header-comment convention (lines 9-47 explaining the "single most security-critical function" reasoning) should be adapted to explain this is the non-Clerk equivalent for resolved WhatsApp identities. Core difference: instead of deriving GUCs from `auth()` + one `team_members` lookup, it takes an already-`resolveIdentity`d `ResolvedIdentity` value and sets the GUCs per the three-branch contract from RESEARCH.md Pattern 3:
```typescript
// Structural mirror of lib/tenant/with-tenant-context.ts lines 74-92,
// branching on identity.type instead of a single member-row presence check
return tenantDb.transaction(async (tx) => {
  await tx.execute(sql`SELECT set_config('app.agency_id', ${agencyId}, true)`);
  if (identity.type === "team_member") {
    await tx.execute(sql`SELECT set_config('app.team_member_id', ${identity.teamMemberId}, true)`);
    await tx.execute(sql`SELECT set_config('app.role', ${identity.role}, true)`);
  } else if (identity.type === "client_contact") {
    await tx.execute(sql`SELECT set_config('app.role', 'client_contact', true)`);
    await tx.execute(sql`SELECT set_config('app.client_id', ${identity.clientId}, true)`);
  }
  // identity.type === "unknown": nothing further set — fail-closed default applies
  return fn(tx);
});
```
Keep this file's doc comment explicit about the `NULLIF`-cast contract every RLS policy reading `app.client_id` must follow (Pitfall 2) — same "why" documentation style as `with-tenant-context.ts` lines 9-47 and `0002`'s file-level comment.

---

### `lib/clients/manage-authorized-contacts.ts` (controller, Server Action — add/remove/list roster)

**Analog 1 (admin-gated mutation pair):** `lib/clients/assign-client.ts` lines 21-58 (`assignClient`/`unassignClient`):
```typescript
// Source: lib/clients/assign-client.ts lines 35-58
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
        .onConflictDoNothing({ target: [clientAssignments.clientId, clientAssignments.teamMemberId] });
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
Apply identically for `addAuthorizedContact`/`removeAuthorizedContact`: `requireOrgContext()` → `withTenantContext` → `assertCallerIsAdmin(tx, userId)` (D-10: admin-only, matching this file's precedent exactly, per RESEARCH.md Open Question #2's recommendation) → insert/delete on `authorizedContacts`.

**Analog 2 (input validation + structured error union):** `lib/team/invite-member.ts` lines 10-33, 55-68 — reuse the exact `WHATSAPP_RE` regex (line 14) for `phoneNumber` validation (per RESEARCH.md "Don't Hand-Roll" table — do not introduce `libphonenumber-js`):
```typescript
// Source: lib/team/invite-member.ts line 14
const WHATSAPP_RE = /^\+[1-9]\d{7,14}$/;
```
And the same "validate before opening a transaction, return `{ ok: false, error: "invalid_X" }` rather than throwing for expected failures" shape (lines 56-68). Also reuse this file's `onConflictDoNothing`-vs-explicit-pre-check tension note (lines 79-89, 104-122) if a similar duplicate-phone race is possible — but here the DB-level unique index + trigger (D-08) is the actual enforcement, so a caught constraint-violation error (mapped to a clear `{ ok: false, error: "phone_already_linked", existingClientId }`-shaped result) is likely cleaner than a pre-check race; the planner should decide the exact error surface, but the validate → transaction → structured-result skeleton is directly reusable.

**Opt-in checkbox field mapping (D-03):** the Server Action's input type must require an explicit `optInConfirmed: true` boolean with no default (matches the schema CHECK described above) plus `confirmedByTeamMemberId` derived from the caller (`userId`'s own `team_members.id`, via `assertCallerIsAdmin`'s returned row — see `current-member.ts` line 63-72's `CurrentTeamMember` return value) — never trust a client-supplied "confirmed by" value.

---

### `scripts/verify-identity-classification.ts` (test, unit, no DB)

**No existing analog file** (first network-free test script in the repo) — but reuse the plain assertion-helper style from `scripts/verify-rls-isolation.ts` lines 34-51, stripped of anything `db`-related:
```typescript
// Source: scripts/verify-rls-isolation.ts lines 34-43 (style to reuse, not the DB parts)
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
Same `main().catch(...)` entrypoint and `process.exitCode = 1` on failure convention (lines 232-240). Test cases: call `classifyIdentity(teamMemberRow, contactRow)` with the 4 ROADMAP-required row-shape combinations (team match, client match, both null → unknown) plus assert the discriminated union's exact field values — zero imports from `lib/db`, `lib/tenant`, or `drizzle-orm`.

---

### `scripts/verify-identity-resolution.ts` (test, integration, real Neon)

**Analog:** `scripts/verify-rls-isolation.ts` (full file, 241 lines) — direct structural parent. Reuse verbatim: the file-header comment style explaining what's being proven and why `db.batch()` (not `withTenantContext`) is used (lines 1-24); the `check()`/`assertRowCount()` helpers (lines 36-51); the `agencyAId`/`agencyBId` random-UUID-suffixed seed pattern (lines 62-67); the `try { ...assertions... } finally { ...cleanup... }` shape (lines 69-230) with cascade-aware cleanup (lines 204-230); the `main().catch(...)` + `process.exitCode` entrypoint (lines 237-240).

**Scenarios to add**, mapped 1:1 to RESEARCH.md's Phase Requirements → Test Map table:
- ROADMAP's 4 required cases: team number, client A contact, client B contact, unknown number → assert `resolveIdentity` returns the correct `ResolvedIdentity` variant for each (SEG-01).
- Second insert of the same `phoneNumber` under a different `clientId` → assert the DB raises a clear error (D-08/SEG-02), reusing the seed/assert/cleanup skeleton.
- Write to `authorized_contacts` under `role='client_contact'` or no context at all → assert 0 rows affected / permission denied, same shape as lines 130-147's "(a)"/"(b)" no-context scenarios (SEG-03).
- `opt_in_confirmed_by_team = true` without `confirmed_by`/`confirmed_at` → assert CHECK constraint violation (SEG-04).
- `client_contact` GUC scope sees exactly its own client via the extended `clients_select_by_role`, never another client — directly extend the existing "cross-agency isolation" assertion style at lines 181-195 to a cross-**client** version for the new third branch (SEG-07).
- Unknown number → zero rows from any tenant table, reusing lines 130-134's "(a) no GUCs set at all -> 0 rows" pattern (SEG-12).
- Same phone number in both `team_members.whatsapp_number` and `authorized_contacts.phone_number` → assert the new trigger (Pitfall 1) raises on the second insert.

**Import note:** like its analog, this script must import the raw `db` export from `lib/db/index.ts` for setup/assertions that need to bypass identity resolution (to prove RLS itself, independent of `resolveIdentity`/`withResolvedIdentityContext` remembering to scope correctly) — but it should ALSO exercise the real `resolveIdentity`/`withResolvedIdentityContext` functions directly for the SEG-01 scenarios, since those are the actual new code under test, not just the RLS policies they lean on.

---

## Shared Patterns

### GUC-setting transaction shape (the single most important pattern in this phase)
**Source:** `lib/tenant/with-tenant-context.ts` lines 65-93
**Apply to:** `lib/identity/resolve-identity.ts`, `lib/tenant/with-resolved-identity-context.ts`
```typescript
return tenantDb.transaction(async (tx) => {
  await tx.execute(sql`SELECT set_config('app.agency_id', ${orgId}, true)`);
  // ...lookup, then set more GUCs conditionally...
  return fn(tx);
});
```
Both new `lib/identity/*`/`lib/tenant/*` files must use `drizzle-orm/neon-serverless` (via a `Pool`, same as line 62-63's module-level singleton), never `drizzle-orm/neon-http` — `neon-http`'s `.transaction()` throws, and this imperative multi-step lookup-then-set flow requires a real persistent connection.

### `NULLIF(..., '')::uuid` for every custom `uuid`-typed GUC
**Source:** `drizzle/migrations/0002_fix_clients_rls_uuid_cast.sql` lines 1-39
**Apply to:** the new `drizzle/migrations/000X_client_contact_rls_scope.sql` (`app.client_id` comparison) and any future RLS policy comparing `app.client_id`, `app.team_member_id`
```sql
id = NULLIF(current_setting('app.client_id', true), '')::uuid
```
Never write a bare `current_setting(...)::uuid` cast in any new policy — Postgres does not guarantee OR short-circuit evaluation, so an unset/reset GUC on a reused pooled connection will crash the query instead of failing closed.

### Admin-only mutation guard
**Source:** `lib/team/current-member.ts` lines 63-72 (`assertCallerIsAdmin`)
**Apply to:** `lib/clients/manage-authorized-contacts.ts` (per D-10)
```typescript
export async function assertCallerIsAdmin(
  tx: TenantTx,
  clerkUserId: string,
): Promise<CurrentTeamMember> {
  const member = await findCallerTeamMember(tx, clerkUserId);
  if (!member || member.role !== "admin") {
    throw new NotAdminError();
  }
  return member;
}
```
Call this exact function (no new admin-check helper needed) from inside `withTenantContext` for every `authorized_contacts` write action — note this only applies to writes originating from an authenticated Clerk admin session (the team-facing roster-management UI/action), not to `resolveIdentity`'s read path, which never has a Clerk session.

### Structured `{ ok, error }` result unions instead of thrown errors for expected failures
**Source:** `lib/team/invite-member.ts` lines 22-33; `lib/clients/assign-client.ts` line 11
**Apply to:** `lib/clients/manage-authorized-contacts.ts`
```typescript
export type InviteMemberResult =
  | { ok: true; teamMemberId: string }
  | { ok: false; error: "not_admin" | "invalid_email" | "invalid_role" | "invalid_whatsapp" | "already_invited" | "clerk_error" };
```
`NotAdminError`/`NoTenantContextError` are still thrown-and-caught at the boundary (see `assign-client.ts` lines 52-57's catch block), but every *expected*, user-facing validation failure returns a typed `error` string, never a thrown generic `Error`.

### Phone number validation regex (reuse, do not reinvent)
**Source:** `lib/team/invite-member.ts` line 14
**Apply to:** `lib/db/schema/authorized-contacts.ts` (documentation/comment only — schema can't validate) and `lib/clients/manage-authorized-contacts.ts` (actual validation)
```typescript
const WHATSAPP_RE = /^\+[1-9]\d{7,14}$/;
```
Extract to a shared `lib/` constant if used in more than one file — RESEARCH.md's Standard Stack section explicitly recommends this over adding `libphonenumber-js`.

### RLS `ENABLE`/`FORCE`/policy-per-concern block shape
**Source:** `drizzle/migrations/0001_rls_policies.sql` lines 73-107 (repeatable per-table block)
**Apply to:** every new migration touching `authorized_contacts` and `audit_log`
```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;
CREATE POLICY <table>_tenant_isolation ON <table>
  USING (agency_id = current_setting('app.agency_id', true))
  WITH CHECK (agency_id = current_setting('app.agency_id', true));
```
`FORCE ROW LEVEL SECURITY` is not optional — Postgres exempts table owners from plain `ENABLE ROW LEVEL SECURITY` unconditionally (0001's own header comment, lines 13-20), and the app connects as `app_user`, a non-owner role, specifically so `FORCE` has an effect.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `lib/identity/types.ts` | model | transform | First discriminated-union identity type in the codebase; no prior "identity shape" type exists to copy structurally (style precedent only: `InviteMemberResult` in `invite-member.ts`) |
| `scripts/verify-identity-classification.ts` | test | transform | First network-free (`db`-free) test script — every existing script (`verify-rls-isolation.ts`, `migrate.ts`) touches the database; only the `check()`-helper *style* carries over |
| Seed-data section of `drizzle/migrations/000X_agent_action_catalog.sql` | migration | batch | No existing migration seeds rows — 0000-0004 are pure DDL/constraints; the `INSERT ... VALUES` seeding for D-02's three action types is new territory (low risk: plain SQL, no Drizzle-specific idiom needed) |

## Metadata

**Analog search scope:** `lib/db/schema/`, `lib/tenant/`, `lib/team/`, `lib/clients/`, `drizzle/migrations/`, `scripts/` (all files in each directory read or already known from RESEARCH.md's Sources section — no directory left unchecked)
**Files scanned:** 15 existing files read directly (`with-tenant-context.ts`, `current-member.ts`, `invite-member.ts`, `assign-client.ts`, `team-members.ts`, `clients.ts`, `client-assignments.ts`, `agencies.ts`, `agent-brand-config.ts`, `schema/index.ts`, `db/index.ts`, `0000_initial_schema.sql`, `0001_rls_policies.sql`, `0002_fix_clients_rls_uuid_cast.sql`, `0003_agencies_status.sql`, `0004_client_assignments_check.sql`, `verify-rls-isolation.ts`) — full directory listings of `lib/db/schema/`, `lib/tenant/`, `lib/team/`, `lib/clients/`, `drizzle/migrations/`, `scripts/` confirmed no additional candidates exist (Phase 1 is the entire codebase so far)
**Pattern extraction date:** 2026-09-08
