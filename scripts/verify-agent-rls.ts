/**
 * Real-Neon proof of the two RLS gaps closed by migrations 0014 and 0015
 * (Phase 4, plan 04-01): `audit_log`'s role branching + append-only
 * hardening, and `messages_select_by_role`'s real three-branch shape. Run
 * with `npx tsx scripts/verify-agent-rls.ts` (wired as
 * `npm run db:verify-agent-rls` by plan 04-02).
 *
 * Needs network egress to Neon and therefore cannot run in a sandboxed
 * session. Migrations 0014 and 0015 must already be applied — this script is
 * NOT run by plan 04-01 itself; plan 04-12 is the live-Neon checkpoint that
 * runs it (see that plan's own verification section).
 *
 * Every scope this script opens goes through the REAL tenant helpers —
 * `withResolvedIdentityContext` (team_member / client_contact / unknown) and
 * `withSystemWebhookContext` (the agent's own writes, same actor shape as the
 * Meta webhook) — never a hand-set Postgres session variable. The proof this produces
 * is that Postgres RLS, not application code, confines each actor; see
 * `verify-whatsapp-webhook.ts` and `verify-identity-resolution.ts` for the
 * same posture in earlier phases.
 *
 * KNOWN OPERATIONAL CONSEQUENCE OF 0014's `REVOKE UPDATE, DELETE ON audit_log
 * FROM app_user` (intentional — the bitácora is append-only forever, even for
 * test cleanup): deleting the seeded agency in the `finally` block cascades
 * (ON DELETE CASCADE) into `audit_log`, and Postgres cascade deletes require
 * DELETE privilege on the referencing table for the role performing them —
 * `app_user` no longer has it. The agency-delete cleanup call below is
 * therefore expected to throw "permission denied for table audit_log" and is
 * caught and logged, exactly like the existing tolerant-cleanup pattern in
 * `verify-whatsapp-webhook.ts` / `verify-identity-resolution.ts` — it does
 * not fail the run. This means every real run of this script against Neon
 * leaves one orphaned test agency (and its audit_log rows) behind; plan
 * 04-12, which actually runs this against live Neon, should note this and
 * decide whether a superuser-side sweep of `verify-agent-rls-*` agencies is
 * warranted. Not fixed here — widening the audit_log GRANT to work around it
 * would silently undo LD-04/T-04-03, the very thing this migration exists to
 * enforce.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { agencies } from "../lib/db/schema/agencies";
import { auditLog } from "../lib/db/schema/audit-log";
import { authorizedContacts } from "../lib/db/schema/authorized-contacts";
import { clientAssignments } from "../lib/db/schema/client-assignments";
import { clients } from "../lib/db/schema/clients";
import { messages } from "../lib/db/schema/messages";
import { teamMembers } from "../lib/db/schema/team-members";
import type { ResolvedIdentity } from "../lib/identity/types";
import { withResolvedIdentityContext } from "../lib/tenant/with-resolved-identity-context";
import { withSystemWebhookContext } from "../lib/tenant/with-system-webhook-context";

const failures: string[] = [];

function check(label: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`  [PASS] ${label}`);
  } else {
    console.log(`  [FAIL] ${label} — ${detail}`);
    failures.push(`${label} — ${detail}`);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function expectThrows(
  label: string,
  fn: () => Promise<unknown>,
  expectedFragment: string,
) {
  try {
    await fn();
    check(label, false, "expected an error, but the statement succeeded");
  } catch (err) {
    const message = errorMessage(err);
    check(
      label,
      message.includes(expectedFragment),
      `error did not mention "${expectedFragment}": ${message}`,
    );
  }
}

/**
 * For the "must never succeed" write assertion against `audit_log`'s
 * system-actor-only INSERT policy (T-04-04): the caller expects an error OR —
 * if the driver ever changes and an RLS `WITH CHECK` failure stops throwing —
 * zero rows actually written. It must never silently succeed with a row in
 * place.
 */
async function attemptIdentityInsertShouldFail<T>(label: string, fn: () => Promise<T[]>) {
  try {
    const result = await fn();
    check(
      label,
      Array.isArray(result) && result.length === 0,
      `expected the insert to fail or return 0 rows, got ${JSON.stringify(result)}`,
    );
  } catch (err) {
    check(label, true, errorMessage(err));
  }
}

async function main() {
  const agencyId = `verify-agent-rls-${randomUUID()}`;
  const adminPhone = `+5740${randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "0")}`;
  const memberAssignedPhone = `+5741${randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "0")}`;
  const memberOtherPhone = `+5742${randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "0")}`;
  const contactAPhone = `+5743${randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "0")}`;

  let adminId: string | undefined;
  let memberAssignedId: string | undefined;
  let memberOtherId: string | undefined;
  let clientAId: string | undefined;
  let clientBId: string | undefined;
  let contactAId: string | undefined;
  let msgClientAId: string | undefined;
  let msgClientBId: string | undefined;
  let msgInternalId: string | undefined;
  let auditClientAId: string | undefined;
  let auditClientBId: string | undefined;
  let auditInternalId: string | undefined;

  try {
    // === Setup ===
    // Every write below opens its scope through withResolvedIdentityContext
    // or withSystemWebhookContext — never a hand-set Postgres session
    // variable — per this script's own contract (see header).
    console.log("Seeding test data...");

    const unknownIdentity: ResolvedIdentity = { type: "unknown" };

    // Creating the agency row itself: `agencies_tenant_isolation` (0007)
    // only requires id = app.agency_id AND role <> 'client_contact', which an
    // unknown-identity scope (no app.role set at all) already satisfies.
    await withResolvedIdentityContext(agencyId, unknownIdentity, (tx) =>
      tx.insert(agencies).values({ id: agencyId, name: "Verify Agent RLS Agency" }));

    // team_members_tenant_isolation likewise only requires role <>
    // 'client_contact' — no admin role needed yet to seed the roster itself.
    const adminRow = await withResolvedIdentityContext(agencyId, unknownIdentity, (tx) =>
      tx
        .insert(teamMembers)
        .values({
          agencyId,
          email: "verify-agent-rls-admin@example.com",
          role: "admin",
          status: "active",
          whatsappNumber: adminPhone,
        })
        .returning({ id: teamMembers.id }));
    adminId = adminRow[0]?.id;

    const memberAssignedRow = await withResolvedIdentityContext(agencyId, unknownIdentity, (tx) =>
      tx
        .insert(teamMembers)
        .values({
          agencyId,
          email: "verify-agent-rls-member-assigned@example.com",
          role: "member",
          status: "active",
          whatsappNumber: memberAssignedPhone,
        })
        .returning({ id: teamMembers.id }));
    memberAssignedId = memberAssignedRow[0]?.id;

    const memberOtherRow = await withResolvedIdentityContext(agencyId, unknownIdentity, (tx) =>
      tx
        .insert(teamMembers)
        .values({
          agencyId,
          email: "verify-agent-rls-member-other@example.com",
          role: "member",
          status: "active",
          whatsappNumber: memberOtherPhone,
        })
        .returning({ id: teamMembers.id }));
    memberOtherId = memberOtherRow[0]?.id;

    if (!adminId || !memberAssignedId || !memberOtherId) {
      throw new Error(
        `Setup failed to produce the expected team member ids (adminId=${adminId}, memberAssignedId=${memberAssignedId}, memberOtherId=${memberOtherId}).`,
      );
    }
    const seededAdminId: string = adminId;

    const adminIdentity: ResolvedIdentity = { type: "team_member", teamMemberId: seededAdminId, role: "admin" };

    // clients_write_admin_only requires app.role = 'admin' exactly.
    const clientARow = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
      tx.insert(clients).values({ agencyId, name: "Client A" }).returning({ id: clients.id }));
    clientAId = clientARow[0]?.id;

    const clientBRow = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
      tx.insert(clients).values({ agencyId, name: "Client B" }).returning({ id: clients.id }));
    clientBId = clientBRow[0]?.id;

    if (!clientAId || !clientBId) {
      throw new Error(`Setup failed to produce the expected client ids (clientAId=${clientAId}, clientBId=${clientBId}).`);
    }
    const seededClientAId: string = clientAId;
    const seededClientBId: string = clientBId;

    // client_assignments_tenant_isolation only requires role <>
    // 'client_contact' — the admin scope already open satisfies it.
    await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
      tx.insert(clientAssignments).values({
        agencyId,
        clientId: seededClientAId,
        teamMemberId: memberAssignedId as string,
      }));

    // authorized_contacts_write_admin_only requires app.role = 'admin'.
    const contactARow = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
      tx
        .insert(authorizedContacts)
        .values({
          agencyId,
          clientId: seededClientAId,
          name: "Contact A",
          phoneNumber: contactAPhone,
          optInConfirmedByTeam: true,
          optInConfirmedBy: seededAdminId,
          optInConfirmedAt: new Date(),
        })
        .returning({ id: authorizedContacts.id }));
    contactAId = contactARow[0]?.id;

    if (!contactAId) {
      throw new Error(`Setup failed to produce the expected contact id (contactAId=${contactAId}).`);
    }
    const seededContactAId: string = contactAId;

    // messages rows written via withSystemWebhookContext, the only actor
    // permitted to write this table alongside human reads (0013/0015).
    const msgClientARow = await withSystemWebhookContext(agencyId, (tx) =>
      tx
        .insert(messages)
        .values({
          agencyId,
          clientId: seededClientAId,
          direction: "inbound",
          channel: "whatsapp",
          fromPhoneNumber: contactAPhone,
          toPhoneNumber: adminPhone,
          metaMessageId: `verify-agent-rls-msg-clienta-${randomUUID()}`,
          resolvedIdentityType: "client_contact",
          resolvedIdentityId: seededContactAId,
          messageType: "text",
          textBody: "mensaje de client A",
        })
        .returning({ id: messages.id }));
    msgClientAId = msgClientARow[0]?.id;

    const msgClientBRow = await withSystemWebhookContext(agencyId, (tx) =>
      tx
        .insert(messages)
        .values({
          agencyId,
          clientId: seededClientBId,
          direction: "inbound",
          channel: "whatsapp",
          fromPhoneNumber: "+573099999999",
          toPhoneNumber: adminPhone,
          metaMessageId: `verify-agent-rls-msg-clientb-${randomUUID()}`,
          resolvedIdentityType: "unknown",
          resolvedIdentityId: null,
          messageType: "text",
          textBody: "mensaje de client B",
        })
        .returning({ id: messages.id }));
    msgClientBId = msgClientBRow[0]?.id;

    const msgInternalRow = await withSystemWebhookContext(agencyId, (tx) =>
      tx
        .insert(messages)
        .values({
          agencyId,
          clientId: null,
          direction: "inbound",
          channel: "whatsapp",
          fromPhoneNumber: memberOtherPhone,
          toPhoneNumber: adminPhone,
          metaMessageId: `verify-agent-rls-msg-internal-${randomUUID()}`,
          resolvedIdentityType: "team_member",
          resolvedIdentityId: memberOtherId,
          messageType: "text",
          textBody: "mensaje interno del equipo",
        })
        .returning({ id: messages.id }));
    msgInternalId = msgInternalRow[0]?.id;

    if (!msgClientAId || !msgClientBId || !msgInternalId) {
      throw new Error(
        `Setup failed to produce the expected message ids (msgClientAId=${msgClientAId}, msgClientBId=${msgClientBId}, msgInternalId=${msgInternalId}).`,
      );
    }

    // audit_log rows, likewise written only via withSystemWebhookContext
    // (0014's audit_log_insert_system_actor).
    const auditClientARow = await withSystemWebhookContext(agencyId, (tx) =>
      tx
        .insert(auditLog)
        .values({
          agencyId,
          clientId: seededClientAId,
          actionTypeCode: "payment_reminder",
          riskLevel: "low",
          summary: "recordatorio de pago enviado a client A",
        })
        .returning({ id: auditLog.id }));
    auditClientAId = auditClientARow[0]?.id;

    const auditClientBRow = await withSystemWebhookContext(agencyId, (tx) =>
      tx
        .insert(auditLog)
        .values({
          agencyId,
          clientId: seededClientBId,
          actionTypeCode: "payment_reminder",
          riskLevel: "low",
          summary: "recordatorio de pago enviado a client B",
        })
        .returning({ id: auditLog.id }));
    auditClientBId = auditClientBRow[0]?.id;

    const auditInternalRow = await withSystemWebhookContext(agencyId, (tx) =>
      tx
        .insert(auditLog)
        .values({
          agencyId,
          clientId: null,
          actionTypeCode: "payment_reminder",
          riskLevel: "low",
          summary: "acción interna del agente, sin cliente asociado",
        })
        .returning({ id: auditLog.id }));
    auditInternalId = auditInternalRow[0]?.id;

    if (!auditClientAId || !auditClientBId || !auditInternalId) {
      throw new Error(
        `Setup failed to produce the expected audit_log ids (auditClientAId=${auditClientAId}, auditClientBId=${auditClientBId}, auditInternalId=${auditInternalId}).`,
      );
    }
    const seededAuditClientAId: string = auditClientAId;

    console.log(
      `Seeded: agency=${agencyId} (admin=${seededAdminId}, memberAssigned=${memberAssignedId}, memberOther=${memberOtherId}, clientA=${seededClientAId}, clientB=${seededClientBId}, contactA=${seededContactAId})\n`,
    );

    const memberAssignedIdentity: ResolvedIdentity = {
      type: "team_member",
      teamMemberId: memberAssignedId,
      role: "member",
    };
    const memberOtherIdentity: ResolvedIdentity = {
      type: "team_member",
      teamMemberId: memberOtherId,
      role: "member",
    };
    const contactAIdentity: ResolvedIdentity = {
      type: "client_contact",
      contactId: seededContactAId,
      clientId: seededClientAId,
      optInConfirmedByTeam: true,
    };
    const unknownScope: ResolvedIdentity = { type: "unknown" };

    // === messages RLS (0015 — Gap 2) ===
    console.log("Running messages RLS assertions...");

    const adminMessages = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
      tx.select().from(messages));
    check(
      "(1) messages/admin scope reads all 3 seeded rows",
      adminMessages.length === 3,
      `expected 3 row(s), got ${adminMessages.length} (${JSON.stringify(adminMessages.map((r) => r.id))})`,
    );

    const memberAssignedMessages = await withResolvedIdentityContext(agencyId, memberAssignedIdentity, (tx) =>
      tx.select().from(messages));
    check(
      "(2a) messages/memberAssigned scope reads exactly 2 rows (its assigned client A + team-internal)",
      memberAssignedMessages.length === 2,
      `expected 2 row(s), got ${memberAssignedMessages.length} (${JSON.stringify(memberAssignedMessages.map((r) => r.id))})`,
    );
    check(
      "(2b) T-04-02 GAP-2 PROOF: memberAssigned, unassigned to client B, cannot see client B's message row",
      !memberAssignedMessages.some((r) => r.id === msgClientBId),
      `client B's message row leaked into memberAssigned's scope: ${JSON.stringify(memberAssignedMessages.map((r) => r.id))}`,
    );

    const memberOtherMessages = await withResolvedIdentityContext(agencyId, memberOtherIdentity, (tx) =>
      tx.select().from(messages));
    check(
      "(3) LD-03: memberOther (assigned to no client) still reads the team-internal row",
      memberOtherMessages.length === 1,
      `expected 1 row, got ${memberOtherMessages.length} (${JSON.stringify(memberOtherMessages.map((r) => r.id))})`,
    );
    check(
      "(3b) memberOther's single visible message row is the team-internal (client_id IS NULL) one",
      memberOtherMessages[0]?.id === msgInternalId,
      `expected ${msgInternalId}, got ${JSON.stringify(memberOtherMessages.map((r) => r.id))}`,
    );

    const contactMessages = await withResolvedIdentityContext(agencyId, contactAIdentity, (tx) =>
      tx.select().from(messages));
    check(
      "(4) messages/client_contact scope reads exactly its own client's row",
      contactMessages.length === 1,
      `expected 1 row, got ${contactMessages.length} (${JSON.stringify(contactMessages.map((r) => r.id))})`,
    );
    check(
      "(4b) client_contact scope does not see the team-internal (client_id IS NULL) message row",
      !contactMessages.some((r) => r.id === msgInternalId),
      `team-internal row leaked into client_contact's scope: ${JSON.stringify(contactMessages.map((r) => r.id))}`,
    );

    const unknownMessages = await withResolvedIdentityContext(agencyId, unknownScope, (tx) =>
      tx.select().from(messages));
    check(
      "(5) SEG-12 regression: unknown identity scope reads 0 rows from messages",
      unknownMessages.length === 0,
      `expected 0 rows, got ${unknownMessages.length} (${JSON.stringify(unknownMessages.map((r) => r.id))})`,
    );

    // === audit_log RLS (0014 — Gap 1) ===
    console.log("\nRunning audit_log RLS assertions...");

    const adminAudit = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) => tx.select().from(auditLog));
    check(
      "(6) audit_log/admin scope reads all 3 seeded rows",
      adminAudit.length === 3,
      `expected 3 row(s), got ${adminAudit.length} (${JSON.stringify(adminAudit.map((r) => r.id))})`,
    );

    const memberAssignedAudit = await withResolvedIdentityContext(agencyId, memberAssignedIdentity, (tx) =>
      tx.select().from(auditLog));
    check(
      "(7) audit_log/memberAssigned scope reads exactly 2 rows (client A + team-internal)",
      memberAssignedAudit.length === 2,
      `expected 2 row(s), got ${memberAssignedAudit.length} (${JSON.stringify(memberAssignedAudit.map((r) => r.id))})`,
    );

    const memberOtherAudit = await withResolvedIdentityContext(agencyId, memberOtherIdentity, (tx) =>
      tx.select().from(auditLog));
    check(
      "(8) LD-03: audit_log/memberOther scope reads exactly the team-internal row",
      memberOtherAudit.length === 1,
      `expected 1 row, got ${memberOtherAudit.length} (${JSON.stringify(memberOtherAudit.map((r) => r.id))})`,
    );

    const contactAudit = await withResolvedIdentityContext(agencyId, contactAIdentity, (tx) => tx.select().from(auditLog));
    check(
      "(9) T-04-01 GAP-1 PROOF: client_contact scope reads exactly 0 rows from audit_log",
      contactAudit.length === 0,
      `expected 0 rows, got ${contactAudit.length} (${JSON.stringify(contactAudit.map((r) => r.id))})`,
    );

    const unknownAudit = await withResolvedIdentityContext(agencyId, unknownScope, (tx) => tx.select().from(auditLog));
    check(
      "(10) SEG-12 regression: unknown identity scope reads 0 rows from audit_log",
      unknownAudit.length === 0,
      `expected 0 rows, got ${unknownAudit.length} (${JSON.stringify(unknownAudit.map((r) => r.id))})`,
    );

    // === audit_log write-path enforcement (T-04-03 / T-04-04) ===
    console.log("\nRunning audit_log write-path assertions...");

    await attemptIdentityInsertShouldFail(
      "(11) T-04-04: an admin's resolved scope cannot INSERT into audit_log (only app.actor='system_webhook' may write)",
      () =>
        withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
          tx
            .insert(auditLog)
            .values({
              agencyId,
              clientId: null,
              actionTypeCode: "payment_reminder",
              riskLevel: "low",
              summary: "forged entry attempted from an admin session",
            })
            .returning({ id: auditLog.id })),
    );

    await expectThrows(
      "(12) T-04-03: UPDATE of a seeded audit_log row is rejected by the REVOKE, even from withSystemWebhookContext",
      () =>
        withSystemWebhookContext(agencyId, (tx) =>
          tx
            .update(auditLog)
            .set({ summary: "tampered" })
            .where(eq(auditLog.id, seededAuditClientAId))),
      "permission denied",
    );

    console.log("");
    if (failures.length === 0) {
      console.log("All assertions passed.");
    } else {
      console.log(`${failures.length} assertion(s) failed:`);
      for (const f of failures) console.log(`  - ${f}`);
    }
  } finally {
    // See the header comment: this delete is expected to throw once
    // audit_log rows exist for this agency, because 0014 revokes DELETE on
    // audit_log from app_user and Postgres cascade deletes require that
    // privilege on every referencing table. Caught and logged, not thrown,
    // matching the existing tolerant-cleanup convention.
    console.log("\nCleaning up test data...");
    try {
      await withResolvedIdentityContext(
        agencyId,
        { type: "team_member", teamMemberId: adminId ?? randomUUID(), role: "admin" },
        (tx) => tx.delete(agencies).where(eq(agencies.id, agencyId)),
      );
    } catch (err) {
      console.error(
        "Cleanup of test agency failed (expected once audit_log rows exist — see header comment):",
        err,
      );
    }
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("verify-agent-rls.ts crashed:", err);
  process.exitCode = 1;
});
