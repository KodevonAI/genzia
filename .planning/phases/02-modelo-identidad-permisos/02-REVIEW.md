---
phase: 02-modelo-identidad-permisos
reviewed: 2026-09-09T00:00:00Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - lib/identity/types.ts
  - lib/identity/classify-identity.ts
  - lib/identity/disclosure.ts
  - lib/identity/resolve-identity.ts
  - lib/tenant/with-resolved-identity-context.ts
  - lib/db/schema/authorized-contacts.ts
  - lib/db/schema/agent-action-catalog.ts
  - lib/db/schema/audit-log.ts
  - lib/db/schema/index.ts
  - lib/clients/manage-authorized-contacts.ts
  - scripts/verify-identity-classification.ts
  - scripts/verify-identity-resolution.ts
  - drizzle/migrations/0005_phase2_identity_tables.sql
  - drizzle/migrations/0006_phase2_identity_rls.sql
  - drizzle/migrations/0007_client_contact_scope.sql
  - drizzle/migrations/0008_agent_action_catalog_seed.sql
  - drizzle/migrations/0009_unknown_identity_lockout_fix.sql
  - drizzle/migrations/0010_revert_bootstrap_regression.sql
  - drizzle/migrations/0011_revert_authorized_contacts_regression.sql
  - package.json
findings:
  critical: 0
  warning: 3
  info: 6
  total: 9
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-09-09
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found

## Summary

Reviewed Phase 2's identity-resolution core (`classifyIdentity` / `resolveIdentity` /
`withResolvedIdentityContext`), the new `authorized_contacts` / `agent_action_catalog`
/ `audit_log` schema and RLS (migrations 0005-0011), the `manage-authorized-contacts.ts`
Server Actions, both verification scripts, and `package.json`. The identity-resolution
pure core (`classifyIdentity`) and its network-free test suite are correct and total
for every documented branch, including the precedence and unknown-identity cases.
`withResolvedIdentityContext`'s fail-closed default for `unknown` identities is
correctly implemented (sets nothing beyond `app.agency_id`).

Migrations 0009 → 0010 → 0011 were checked line-by-line against 0006/0007's original
clauses: the revert is byte-for-byte exact for all five affected policies
(`team_members_tenant_isolation`, `client_assignments_tenant_isolation`,
`agent_brand_config_tenant_isolation`, `agencies_tenant_isolation`,
`authorized_contacts_select_team_only`). No typos, no partial reverts. The residual
SEG-12 gap this sequence left open (an `unknown` identity's post-resolution scope can
still read `team_members`/`authorized_contacts` if a future call site ever queries
them under that scope) is already tracked in `02-07-SUMMARY.md` with no current
exploitable call site — not re-flagged as a new finding here per the review brief.

No Critical issues were found (no injection vectors, no hardcoded secrets, no auth
bypass — all queries are parameterized via Drizzle, and every admin-only write path
is guarded by both an explicit `assertCallerIsAdmin` check and RLS). Three Warnings
and six Info items are below, mostly around an unexercised-but-real trigger
self-match bug, a schema/CHECK-constraint conflict on team-member deletion, and an
error-taxonomy gap that would produce a misleading UI message for one duplicate-phone
scenario.

## Warnings

### WR-01: `authorized_contacts` phone-uniqueness trigger doesn't exclude the row being updated

**File:** `drizzle/migrations/0006_phase2_identity_rls.sql:130-136`
**Issue:** `authorized_contacts_phone_uniqueness_guard()` fires on both `INSERT` and
`UPDATE`. Its second check is:

```sql
SELECT clients.name INTO existing_client_name
FROM authorized_contacts
JOIN clients ON clients.id = authorized_contacts.client_id
WHERE authorized_contacts.agency_id = NEW.agency_id
  AND authorized_contacts.phone_number = NEW.phone_number
  AND authorized_contacts.client_id <> NEW.client_id
LIMIT 1;
```

For an `INSERT`, `NEW.id` doesn't exist yet in the table, so this is safe. For an
`UPDATE` that reassigns a contact to a different client while keeping the same
`phone_number` (e.g. a future "move this contact to another client" admin action),
the query matches the row's own pre-update state — same `phone_number`, and
`client_id <> NEW.client_id` is true precisely because the caller is trying to change
it — and raises a false "already linked to client" exception, blocking a legitimate
update. No current code path performs such an update (`manage-authorized-contacts.ts`
only inserts/deletes), so this is latent rather than exploited today, but it is a
real correctness bug in an in-scope migration.
**Fix:** Exclude the row being updated from the self-check:
```sql
WHERE authorized_contacts.agency_id = NEW.agency_id
  AND authorized_contacts.phone_number = NEW.phone_number
  AND authorized_contacts.client_id <> NEW.client_id
  AND authorized_contacts.id <> NEW.id
```
(`NEW.id` is populated for both `INSERT` and `UPDATE` in Postgres row triggers.)

### WR-02: `opt_in_confirmed_by`'s `ON DELETE SET NULL` conflicts with the opt-in CHECK constraint

**File:** `lib/db/schema/authorized-contacts.ts:56-77` (schema), `drizzle/migrations/0005_phase2_identity_tables.sql:9-13,37`
**Issue:** `optInConfirmedBy` references `team_members.id` with `onDelete: "set null"`,
but `authorized_contacts_opt_in_consistency_check` requires
`(opt_in_confirmed_by_team = false) OR (opt_in_confirmed_by IS NOT NULL AND opt_in_confirmed_at IS NOT NULL)`.
If a team member who has confirmed at least one contact's opt-in is ever deleted, the
FK's cascading `SET NULL` update on `authorized_contacts.opt_in_confirmed_by` will
violate this CHECK constraint on any row where `opt_in_confirmed_by_team = true` —
the whole deleting transaction fails instead of the reference degrading gracefully.
There is no team-member-deletion code path yet, so this hasn't been observed, but the
schema itself is internally inconsistent: the FK's `onDelete` behavior implies "this
should null out safely," while the CHECK constraint guarantees it never can once
`opt_in_confirmed_by_team = true`.
**Fix:** Either (a) change the FK to `onDelete: "restrict"`/`"no action"` and make the
future team-member-removal flow explicitly re-attribute or clear
`opt_in_confirmed_by_team` first, or (b) if silent nulling is truly desired, relax the
CHECK to allow `opt_in_confirmed_by IS NULL` for historically-confirmed rows (e.g. an
additional `opt_in_confirmed_by_team_member_deleted` flag) so the two constraints stop
contradicting each other.

### WR-03: `addAuthorizedContact`'s duplicate-phone error result can't distinguish a team-member-number collision from a client collision

**File:** `lib/clients/manage-authorized-contacts.ts:41-44,104-135`
**Issue:** `AddAuthorizedContactResult`'s only duplicate-phone variant is
`{ ok: false; error: "phone_already_linked"; existingClientName: string | null }`.
The catch block treats three different Postgres error messages as the same
`isDuplicate` case (lines 112-115): "already linked to client" (a real client
collision — `existingClientName` gets populated), the unique-index violation, and
"already registered as a team member WhatsApp number" (migration 0006's cross-table
trigger). For the team-member-collision case, the fallback lookup at lines 118-129
queries `authorized_contacts` — which has no row for that number — so
`existingClientName` always resolves to `null`. The caller/UI has no way to tell "this
number belongs to another client" (an expected `null` when the client couldn't be
resolved) apart from "this number belongs to a team member" (always `null` by
construction), so a UI built to say "already linked to client {name}" would render
misleadingly (e.g. "already linked to client" with no name) for the team-member case.
**Fix:** Give the team-member collision its own typed error, matched before falling
into the generic client-collision branch, e.g.:
```ts
if (message.includes("already registered as a team member WhatsApp number")) {
  return { ok: false, error: "phone_registered_to_team" };
}
```
and add `"phone_registered_to_team"` to the plain (non-`existingClientName`) error
union in `AddAuthorizedContactResult`.

## Info

### IN-01: Unchecked role cast in `classifyIdentity`

**File:** `lib/identity/classify-identity.ts:35`
**Issue:** `role: teamMemberRow.role as "admin" | "member"` trusts the DB `role`
column's shape via a type assertion rather than a runtime check. `team_members`'s
`team_members_role_check` CHECK constraint currently guarantees this at the DB layer,
and the same pattern is already used in `lib/team/current-member.ts`, so this is
consistent with an established (if unverified) codebase convention rather than a new
risk.
**Fix:** No change required to match convention; if hardening is ever desired, a
small runtime guard (`role === "admin" || role === "member" ? role : (() => { throw ... })()`)
would remove the assertion in both places at once.

### IN-02: Phone number not trimmed before validation/storage in `addAuthorizedContact`

**File:** `lib/clients/manage-authorized-contacts.ts:59-65,88`
**Issue:** `trimmedName` is explicitly trimmed before validation, but
`input.phoneNumber` is validated and stored as-is:
`WHATSAPP_RE.test(input.phoneNumber)` / `phoneNumber: input.phoneNumber`.
`lib/team/invite-member.ts`'s equivalent flow trims (`input.whatsappNumber.trim()`)
before validating. A phone number with incidental leading/trailing whitespace (e.g.
pasted from a UI field) will simply be rejected as `invalid_phone` here instead of
being normalized, unlike the team-invite flow.
**Fix:** `const trimmedPhone = input.phoneNumber.trim();` and use it for both the
regex test and the insert value, mirroring `invite-member.ts`.

### IN-03: `email` accepted without format validation

**File:** `lib/clients/manage-authorized-contacts.ts:26-39,58-71`
**Issue:** `AddAuthorizedContactInput.email` is inserted via `input.email ?? null`
with no format check, whereas `lib/team/invite-member.ts` validates its `email` field
against `EMAIL_RE` and normalizes it (`trim().toLowerCase()`) before use. Not a
security issue (the value isn't used for auth or sent anywhere in Phase 2), but it's
an inconsistency with the established validation convention in the same module
family, and a malformed value would only surface as a problem much later (e.g. if a
future phase emails this contact).
**Fix:** Reuse (or extract to a shared module) `invite-member.ts`'s `EMAIL_RE` and
apply the same trim/lowercase/validate treatment when `input.email` is non-null.

### IN-04: `WHATSAPP_RE` duplicated verbatim across two files

**File:** `lib/clients/manage-authorized-contacts.ts:16`, `lib/team/invite-member.ts:14`
**Issue:** Both files define the identical
`/^\+[1-9]\d{7,14}$/` regex with a comment cross-referencing the other file as the
reason it must stay identical. This is documented and intentional, but it is still
duplicated logic that a future edit to one copy could silently desync from the other.
**Fix:** Extract to a small shared module (e.g. `lib/shared/phone.ts`) exporting
`WHATSAPP_RE`, imported by both call sites, so there is exactly one definition to keep
in sync.

### IN-05: Duplicate-detection in `addAuthorizedContact`'s catch block relies on matching raw Postgres error text

**File:** `lib/clients/manage-authorized-contacts.ts:111-115`
**Issue:**
```ts
const isDuplicate =
  message.includes("authorized_contacts_agency_id_phone_number_idx") ||
  message.includes("is already linked to client") ||
  message.includes("is already registered as a team member WhatsApp number");
```
This is a reasonable best-effort approach given Postgres doesn't expose structured
constraint identifiers through the driver in use here, and the header comment
acknowledges the real enforcement is the DB layer regardless of whether this lookup
succeeds — but it is inherently fragile: any future wording change to the trigger's
`RAISE EXCEPTION` messages (migration 0006, lines 125-127/139-141) or to the unique
index's name would silently stop being recognized as a duplicate, degrading straight
to the generic thrown-error path with no user-facing typed error.
**Fix:** No urgent change needed; if this becomes a recurring source of drift,
consider using Postgres's `SQLSTATE` (`23505` for unique violation) plus a
constraint-name field surfaced by the driver, where available, instead of substring
matching on the human-readable message.

### IN-06: Inconsistent npm script naming for the two identity-verification scripts

**File:** `package.json:10-13`
**Issue:**
```json
"db:verify-rls": "tsx scripts/verify-rls-isolation.ts",
"verify:identity-classification": "tsx scripts/verify-identity-classification.ts",
"db:verify-identity": "tsx scripts/verify-identity-resolution.ts"
```
The network-free classification test uses a `verify:` prefix while the two
DB-backed tests use `db:verify-`. Both scripts belong to the same Phase 2 test
matrix (as their own header comments say), so the split prefix makes the pair harder
to discover together (e.g. via `npm run db:verify` tab-completion).
**Fix:** Rename `"verify:identity-classification"` to
`"verify-identity-classification"` (no `db:` prefix, since it needs no network) or
adopt one consistent prefix scheme across all three (e.g. `verify:rls`,
`verify:identity-classification`, `verify:identity-resolution`).

---

_Reviewed: 2026-09-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
