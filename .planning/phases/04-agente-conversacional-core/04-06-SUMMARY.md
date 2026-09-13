---
phase: 04-agente-conversacional-core
plan: 06
subsystem: api, security
tags: [anthropic-sdk, postgres-rls, drizzle, prompt-injection-defense]

requires:
  - phase: 04-agente-conversacional-core
    plan: "04-03"
    provides: approval_queue table, audit_log.status/approvalId columns
  - phase: 04-agente-conversacional-core
    plan: "04-04"
    provides: TurnActor/AgentContext/ConversationKey type contracts
provides:
  - "classifyAndExecute — the SEG-10 gate every tool call passes through (lib/agent/risk-interceptor.ts)"
  - "TOOL_TO_CATALOG_CODE — the hard-coded tool-name -> catalog-code map"
  - "writeAuditLog — the only audit_log writer (lib/agent/audit.ts)"
  - "AGENT_TOOLS/toolsFor/executeTool — the tool registry (lib/agent/tools/index.ts)"
  - "send_payment_reminder (low) and draft_client_content (high) tools"
affects: [04-07, 04-08, 04-09, 04-10, 04-12]

tech-stack:
  added: []
  patterns:
    - "Model output is a proposal, never a command: every tool_use block passes through a deterministic interceptor before any side effect, with risk classification sourced from a hard-coded code-level map, never from the model's own arguments"
    - "A shared delivery helper (deliverToClient) resolves the recipient in the caller's own RLS scope before opening the system-webhook scope to write, so an unassigned client fails closed without a duplicated application-level assignment check"

key-files:
  created:
    - lib/agent/audit.ts
    - lib/agent/tools/index.ts
    - lib/agent/tools/deliver-to-client.ts
    - lib/agent/tools/send-payment-reminder.ts
    - lib/agent/tools/draft-client-content.ts
    - lib/agent/risk-interceptor.ts

key-decisions:
  - "requestedByIdentityId / resolvedIdentityId are derived from actor.identity.type (team_member -> teamMemberId, client_contact -> contactId, unknown -> null) rather than hard-coded to team_member, even though only team_member turns can currently reach a tool call — keeps both the outbound messages row and the approval_queue row's attribution accurate to ResolvedIdentity's actual shape."
  - "A missing agent_action_catalog row (a programming error — a TOOL_TO_CATALOG_CODE entry with no seeded catalog row) is audited with riskLevel 'high' as the conservative default, since the real classification is unknown at that point and audit_log's CHECK constraint requires 'low'|'high'."
  - "deliverToClient reads META_WHATSAPP_PHONE_NUMBER_ID directly for the outbound row's `from` field rather than threading a platformPhoneNumber parameter through both tools, since a proactive agent-initiated send (unlike send-whatsapp-ack.ts's reply) has no inbound webhook event to copy displayPhoneNumber from."

requirements-completed: [SEG-10, SEG-11, SEG-07]

duration: ~1h
completed: 2026-09-13
---

# Phase 4 Plan 06: Risk Interceptor and Tool Registry Summary

**`classifyAndExecute` — the SEG-10 gate that treats every Claude tool call as a proposal subject to deterministic policy checks: risk comes from a hard-coded map into the static `agent_action_catalog`, never from the model's own output; low-risk tools execute and audit immediately, high-risk tools are queued for human approval and never executed, and both branches write the bitácora.**

## Performance

- **Tasks:** 2/2
- **Files created:** 6

## Accomplishments

- `lib/agent/audit.ts`: `writeAuditLog` — the codebase's single `audit_log` writer, inserting through `withSystemWebhookContext` (LD-11) so a `client_contact`'s turn can never author its own audit trail.
- `lib/agent/tools/deliver-to-client.ts`: shared delivery helper. Resolves the client's opted-in `authorized_contacts` row first, inside the caller's own RLS scope (no manual assignment check — RLS is the only boundary), sends via `sendWhatsAppTextMessage`, then persists the outbound `messages` row as the system actor, copying `send-whatsapp-ack.ts`'s field mapping and `onConflictDoNothing` target exactly.
- `lib/agent/tools/send-payment-reminder.ts`: `send_payment_reminder` (catalog code `payment_reminder`, risk `low`) — hand-written input narrowing (no schema-validation dependency), delegates to `deliverToClient`.
- `lib/agent/tools/draft-client-content.ts`: `draft_client_content` (catalog code `new_client_content`, risk `high`) — same shape; its `execute()` is documented as reachable only through the future approval-replay path, never called inline by the interceptor.
- `lib/agent/tools/index.ts`: `AGENT_TOOLS` (exactly the two tools above — `reschedule_appointment` deliberately has none, per LD-06), `toolsFor(identity)` (tools only for `team_member`, empty array otherwise — LD-12), `executeTool` (unknown tool name returns a message string instead of throwing).
- `lib/agent/risk-interceptor.ts`: `classifyAndExecute` and the exported `TOOL_TO_CATALOG_CODE` map. Five ordered steps, each commented with what it prevents: (1) map tool name to catalog code or reject with no catalog read; (2) cross-check `input.clientId` — well-formed UUID, matches a `client_contact`'s own `clientId`, rejects any `unknown` actor outright; (3) classify via the plain unscoped `db` (legitimate here — `agent_action_catalog` has no RLS); (4) low branch executes via `executeTool`, audits `executed`, catches a thrown error into an audited `failed` result instead of aborting the turn; (5) high branch inserts into `approval_queue` with `onConflictDoNothing` on `(agencyId, toolUseId)` (idempotent against Inngest step retries, re-selecting the existing row id on conflict), audits `pending_approval` linked by `approvalId`, and returns the fixed Spanish "awaiting approval" tool_result so the model can never honestly claim the action happened (SEG-09).

## Task Commits

1. **Task 1: audit.ts + tool registry + two tools** - `d267f29` (feat)
2. **Task 2: risk-interceptor.ts** - `31c5a9e` (feat)

## Files Created/Modified

- `lib/agent/audit.ts` - `writeAuditLog`, `AuditStatus`
- `lib/agent/tools/deliver-to-client.ts` - `deliverToClient`, `DeliverToClientResult`
- `lib/agent/tools/send-payment-reminder.ts` - `definition`, `catalogCode`, `execute` (low)
- `lib/agent/tools/draft-client-content.ts` - `definition`, `catalogCode`, `execute` (high, replay-only)
- `lib/agent/tools/index.ts` - `AGENT_TOOLS`, `toolsFor`, `executeTool`
- `lib/agent/risk-interceptor.ts` - `classifyAndExecute`, `TOOL_TO_CATALOG_CODE`, `describeToolCall`

## Decisions Made

- `deliverToClient`'s recipient resolution runs inside `withResolvedIdentityContext(agencyId, identity, ...)` — the caller's own scope — precisely so an unassigned client for a `team_member` fails closed via RLS rather than a duplicated, driftable application-level assignment check (per the plan's explicit instruction and RESEARCH.md's Pitfall-4 spirit of not re-implementing a boundary RLS already owns).
- `classifyAndExecute`'s scope cross-check runs before the catalog read (step 2 before step 3), so a rejected call never touches `agent_action_catalog` at all — matches the "no execution, no catalog read" requirement for both the unmapped-tool-name and out-of-scope-clientId cases.
- Kept the interceptor's tool-call counter guarantee simple: `executeTool(` appears exactly once in the file (inside the low branch), verified by the plan's own automated check, so the high branch's "execution is NOT attempted" claim is structurally true, not just documented.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' files, exports, and behaviors match the plan's interfaces and action specs; all acceptance criteria and the plan's `<verify><automated>` scripts pass as given.

## Verification Performed

- `npx tsc --noEmit` — exits 0.
- `npx eslint` (project-wide `npm run lint`) — exits 0.
- `npm run verify:agent-prompt` — all 10 assertions pass, no regression.
- Task 1 acceptance criteria: `insert(auditLog)` appears in exactly one file (`lib/agent/audit.ts`); `withSystemWebhookContext(` present in `audit.ts`; `optInConfirmedByTeam` present in `deliver-to-client.ts`; `identity.type === "team_member"` present in `tools/index.ts`; `reschedule_appointment` appears only inside a comment in `lib/agent/`; no `zod` or `clientAssignments` string anywhere under `lib/agent/tools/`.
- Task 2 acceptance criteria: `TOOL_TO_CATALOG_CODE` has exactly 2 entries; `executeTool(` appears exactly once (low branch only); `onConflictDoNothing` present; the literal string `aprobación del equipo` present in the returned tool_result; no code path reads a risk level from `toolUse.input` (`input.risk`/`input).riskLevel` absent from the file); the UUID regex check on `input.clientId` is present.
- Plan's own `<verify><automated>` node scripts for both tasks — pass.

## Deferred to Plan 04-08 / 04-12 (real-Neon proof)

Per this session's explicit scope, this plan implements `classifyAndExecute`, the tool registry, and the audit writer entirely against code-level and static-analysis verification (tsc/eslint/grep/the plan's own node scripts) — it does not open a live Neon connection. The following are deliberately deferred:

- Proving the low branch actually executes a tool and writes exactly one `executed` `audit_log` row against real Postgres.
- Proving the high branch actually inserts one `approval_queue` row (`status: 'pending'`) and one linked `pending_approval` `audit_log` row, and that a repeated `tool_use_id` produces exactly one `approval_queue` row via `onConflictDoNothing`.
- Proving `deliverToClient` really refuses to send when no authorized contact has `optInConfirmedByTeam = true`, and that RLS (not application code) is what makes an unassigned client's contact unreachable for a `team_member`.
- Any live assertion that `agent_action_catalog`'s seeded rows (`payment_reminder` low, `new_client_content`/`reschedule_appointment` high) round-trip correctly through the plain unscoped `db` read.

Plan 04-08's real-Neon integration suite is the designated place for all of the above; plan 04-12 is the phase's final live checkpoint that applies migrations 0014/0015/0016 (still unapplied to any real database as of this plan) and re-confirms the whole chain end to end.

## User Setup Required

None beyond what prior plans in this phase already documented (`OPENROUTER_API_KEY`/`ANTHROPIC_API_KEY`, `META_WHATSAPP_PHONE_NUMBER_ID`/`META_WHATSAPP_ACCESS_TOKEN`, `DATABASE_URL`) — this plan's code doesn't introduce any new environment variable or external dependency.

## Threat Flags

None — every file created in this plan is exactly the surface the plan's own `<threat_model>` (T-04-26 through T-04-32) already covers: the interceptor's classification, scope cross-check, idempotent approval insert, and audit trail; the tools' `execute()` paths through the pre-existing WhatsApp send pipeline. No new network endpoint, auth path, or schema change was introduced beyond what the plan specifies.

## Next Phase Readiness

`classifyAndExecute`, `toolsFor`, and `writeAuditLog` are ready for plan 04-07 (`runTurn`, the agent loop that calls Claude, receives `tool_use` blocks, and routes each one through this interceptor before continuing the turn). Plan 04-09 (approval decision + replay) can now import `draft_client_content`'s `execute()` directly for its replay path, and `AGENT_TOOLS`/`TOOL_TO_CATALOG_CODE` for validating a decided row's `tool_name` against the same registry the interceptor used at proposal time. Plan 04-08's real-Neon suite is the first place this plan's SEG-10 guarantees get proven against live Postgres.

---
*Phase: 04-agente-conversacional-core*
*Completed: 2026-09-13*

## Self-Check: PASSED

All 6 created files confirmed present on disk (`lib/agent/audit.ts`, `lib/agent/tools/index.ts`, `lib/agent/tools/deliver-to-client.ts`, `lib/agent/tools/send-payment-reminder.ts`, `lib/agent/tools/draft-client-content.ts`, `lib/agent/risk-interceptor.ts`), plus this SUMMARY.md. Both task commit hashes (`d267f29`, `31c5a9e`) confirmed present in `git log`.
