/**
 * Real-Neon integration suite for everything Phase 4 added to the database
 * boundary: `buildAgentContext`'s SEG-05..08 scoping for all four identity
 * shapes, and the SEG-10 risk engine's two branches plus the `approval_queue`
 * RLS that keeps a proposed high-risk action invisible to the client it is
 * about (LD-04). Run with `npx tsx scripts/verify-agent.ts` (wired as
 * `npm run db:verify-agent` by plan 04-02).
 *
 * Needs network egress to Neon and therefore cannot run in a sandboxed
 * session. Migrations 0014-0016 must already be applied — this script is NOT
 * run by plan 04-08 itself; plan 04-12 is the live-Neon checkpoint that runs
 * it (see that plan's own verification section).
 *
 * Every scope this script opens goes through the REAL tenant helpers —
 * `withResolvedIdentityContext` and `withSystemWebhookContext` — and every
 * assertion calls the REAL `buildAgentContext`, `toolsFor` and (in the
 * second section) `classifyAndExecute`, never a reimplementation of any of
 * them. See `scripts/verify-agent-rls.ts` (04-01) for the same posture and
 * the seeding shape this script deliberately mirrors, under a SEPARATE
 * agency id so the two scripts can run back to back without colliding.
 *
 * Outbound WhatsApp sends are stubbed at the `fetch` layer, exactly as
 * `scripts/verify-whatsapp-send.ts` does it — a run of this script must
 * never deliver a real message to a real phone. The turn loop's own
 * behaviour (the actual LLM call) is deliberately NOT exercised here; that
 * is covered by the live checkpoint (04-12). What is proven here is the
 * deterministic layer underneath it — classification, queueing, auditing,
 * scoping and RLS — provable without an API key and without spending tokens
 * on every run.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { agencies } from "../lib/db/schema/agencies";
import { approvalQueue } from "../lib/db/schema/approval-queue";
import { auditLog } from "../lib/db/schema/audit-log";
import { authorizedContacts } from "../lib/db/schema/authorized-contacts";
import { clientAssignments } from "../lib/db/schema/client-assignments";
import { clients } from "../lib/db/schema/clients";
import { messages } from "../lib/db/schema/messages";
import { teamMembers } from "../lib/db/schema/team-members";
import { buildAgentContext } from "../lib/agent/build-context";
import { classifyAndExecute } from "../lib/agent/risk-interceptor";
import { toolsFor } from "../lib/agent/tools";
import type { TurnActor } from "../lib/agent/types";
import { AI_DISCLOSURE_RULE } from "../lib/identity/disclosure";
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

type Seeded = {
  adminId: string;
  memberAssignedId: string;
  memberOtherId: string;
  clientAId: string;
  clientBId: string;
  contactAId: string;
  contactBId: string;
  adminPhone: string;
  memberAssignedPhone: string;
  memberOtherPhone: string;
  contactAPhone: string;
  contactBPhone: string;
};

/**
 * Seeds one complete agency under `agencyId`: three team members (admin,
 * an assigned member, an unassigned member), two clients, one client
 * assignment, two authorized contacts (one opted in, one NOT — the SEG-04
 * negative case), and six `messages` rows via `withSystemWebhookContext`
 * (two per client's contact, two for a team-internal thread with
 * `client_id = NULL`).
 */
async function seed(agencyId: string): Promise<Seeded> {
  const adminPhone = `+5750${randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "0")}`;
  const memberAssignedPhone = `+5751${randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "0")}`;
  const memberOtherPhone = `+5752${randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "0")}`;
  const contactAPhone = `+5753${randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "0")}`;
  const contactBPhone = `+5754${randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "0")}`;

  const unknownIdentity: ResolvedIdentity = { type: "unknown" };

  await withResolvedIdentityContext(agencyId, unknownIdentity, (tx) =>
    tx.insert(agencies).values({ id: agencyId, name: "Verify Agent Agency" }));

  const [adminRow] = await withResolvedIdentityContext(agencyId, unknownIdentity, (tx) =>
    tx
      .insert(teamMembers)
      .values({
        agencyId,
        email: "verify-agent-admin@example.com",
        role: "admin",
        status: "active",
        whatsappNumber: adminPhone,
      })
      .returning({ id: teamMembers.id }));

  const [memberAssignedRow] = await withResolvedIdentityContext(agencyId, unknownIdentity, (tx) =>
    tx
      .insert(teamMembers)
      .values({
        agencyId,
        email: "verify-agent-member-assigned@example.com",
        role: "member",
        status: "active",
        whatsappNumber: memberAssignedPhone,
      })
      .returning({ id: teamMembers.id }));

  const [memberOtherRow] = await withResolvedIdentityContext(agencyId, unknownIdentity, (tx) =>
    tx
      .insert(teamMembers)
      .values({
        agencyId,
        email: "verify-agent-member-other@example.com",
        role: "member",
        status: "active",
        whatsappNumber: memberOtherPhone,
      })
      .returning({ id: teamMembers.id }));

  const adminId = adminRow?.id;
  const memberAssignedId = memberAssignedRow?.id;
  const memberOtherId = memberOtherRow?.id;
  if (!adminId || !memberAssignedId || !memberOtherId) {
    throw new Error(
      `Setup failed to produce the expected team member ids (adminId=${adminId}, memberAssignedId=${memberAssignedId}, memberOtherId=${memberOtherId}).`,
    );
  }

  const adminIdentity: ResolvedIdentity = { type: "team_member", teamMemberId: adminId, role: "admin" };

  const [clientARow] = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
    tx.insert(clients).values({ agencyId, name: "Client A" }).returning({ id: clients.id }));
  const [clientBRow] = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
    tx.insert(clients).values({ agencyId, name: "Client B" }).returning({ id: clients.id }));

  const clientAId = clientARow?.id;
  const clientBId = clientBRow?.id;
  if (!clientAId || !clientBId) {
    throw new Error(`Setup failed to produce the expected client ids (clientAId=${clientAId}, clientBId=${clientBId}).`);
  }

  await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
    tx.insert(clientAssignments).values({
      agencyId,
      clientId: clientAId,
      teamMemberId: memberAssignedId,
    }));

  const [contactARow] = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
    tx
      .insert(authorizedContacts)
      .values({
        agencyId,
        clientId: clientAId,
        name: "Contact A",
        phoneNumber: contactAPhone,
        optInConfirmedByTeam: true,
        optInConfirmedBy: adminId,
        optInConfirmedAt: new Date(),
      })
      .returning({ id: authorizedContacts.id }));

  // The SEG-04 negative case: clientB's only contact has NOT been attested
  // by the team, so any send targeting clientB must be blocked downstream.
  const [contactBRow] = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
    tx
      .insert(authorizedContacts)
      .values({
        agencyId,
        clientId: clientBId,
        name: "Contact B",
        phoneNumber: contactBPhone,
        optInConfirmedByTeam: false,
      })
      .returning({ id: authorizedContacts.id }));

  const contactAId = contactARow?.id;
  const contactBId = contactBRow?.id;
  if (!contactAId || !contactBId) {
    throw new Error(`Setup failed to produce the expected contact ids (contactAId=${contactAId}, contactBId=${contactBId}).`);
  }

  async function seedMessage(
    from: string,
    to: string,
    clientId: string | null,
    resolvedIdentityType: ResolvedIdentity["type"],
    resolvedIdentityId: string | null,
    text: string,
  ) {
    await withSystemWebhookContext(agencyId, (tx) =>
      tx.insert(messages).values({
        agencyId,
        clientId,
        direction: "inbound",
        channel: "whatsapp",
        fromPhoneNumber: from,
        toPhoneNumber: to,
        metaMessageId: `verify-agent-msg-${randomUUID()}`,
        resolvedIdentityType,
        resolvedIdentityId,
        messageType: "text",
        textBody: text,
      }));
  }

  await seedMessage(contactAPhone, adminPhone, clientAId, "client_contact", contactAId, "mensaje 1 de client A");
  await seedMessage(contactAPhone, adminPhone, clientAId, "client_contact", contactAId, "mensaje 2 de client A");
  await seedMessage(contactBPhone, adminPhone, clientBId, "client_contact", contactBId, "mensaje 1 de client B");
  await seedMessage(contactBPhone, adminPhone, clientBId, "client_contact", contactBId, "mensaje 2 de client B");
  await seedMessage(memberOtherPhone, adminPhone, null, "team_member", memberOtherId, "mensaje interno 1");
  await seedMessage(memberOtherPhone, adminPhone, null, "team_member", memberOtherId, "mensaje interno 2");

  return {
    adminId,
    memberAssignedId,
    memberOtherId,
    clientAId,
    clientBId,
    contactAId,
    contactBId,
    adminPhone,
    memberAssignedPhone,
    memberOtherPhone,
    contactAPhone,
    contactBPhone,
  };
}

function joinedText(context: { messages: { content: unknown }[] }): string {
  return context.messages
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n");
}

async function main() {
  // Meta env fixtures, same convention as verify-whatsapp-send.ts — a
  // credential-shaped value that is never actually sent anywhere real
  // because fetch itself is stubbed below.
  process.env.META_WHATSAPP_PHONE_NUMBER_ID = "123456789012345";
  process.env.META_WHATSAPP_ACCESS_TOKEN = "verify-agent-test-token";

  const graphCalls: { url: string; init: RequestInit }[] = [];
  let graphMessageCounter = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("graph.facebook.com")) {
      graphMessageCounter += 1;
      graphCalls.push({ url, init: init ?? {} });
      return new Response(
        JSON.stringify({ messages: [{ id: `wamid.verify-${graphMessageCounter}` }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return originalFetch(input, init);
  }) as typeof globalThis.fetch;

  const agencyId = `verify-agent-${randomUUID()}`;
  let seeded: Seeded | undefined;

  try {
    console.log("Seeding test data...");
    seeded = await seed(agencyId);
    console.log(
      `Seeded: agency=${agencyId} (admin=${seeded.adminId}, memberAssigned=${seeded.memberAssignedId}, memberOther=${seeded.memberOtherId}, clientA=${seeded.clientAId}, clientB=${seeded.clientBId})\n`,
    );

    const adminIdentity: ResolvedIdentity = { type: "team_member", teamMemberId: seeded.adminId, role: "admin" };
    const memberAssignedIdentity: ResolvedIdentity = {
      type: "team_member",
      teamMemberId: seeded.memberAssignedId,
      role: "member",
    };
    const memberOtherIdentity: ResolvedIdentity = {
      type: "team_member",
      teamMemberId: seeded.memberOtherId,
      role: "member",
    };
    const contactAIdentity: ResolvedIdentity = {
      type: "client_contact",
      contactId: seeded.contactAId,
      clientId: seeded.clientAId,
      optInConfirmedByTeam: true,
    };
    const unknownIdentity: ResolvedIdentity = { type: "unknown" };

    // === SEG-05..08: buildAgentContext scoping, all four identity shapes ===
    console.log("Running SEG-05..08 context-scoping assertions...");

    const adminContext = await buildAgentContext(
      agencyId,
      adminIdentity,
      { channel: "whatsapp", counterpartPhoneNumber: seeded.contactAPhone },
      toolsFor(adminIdentity),
    );
    check(
      "(1) admin context for clientA's phone is non-empty and contains clientA's text",
      adminContext.messages.length > 0 && joinedText(adminContext).includes("mensaje 1 de client A"),
      `got ${adminContext.messages.length} message(s): ${joinedText(adminContext)}`,
    );

    const memberAssignedContextA = await buildAgentContext(
      agencyId,
      memberAssignedIdentity,
      { channel: "whatsapp", counterpartPhoneNumber: seeded.contactAPhone },
      toolsFor(memberAssignedIdentity),
    );
    check(
      "(2) memberAssigned context for clientA's phone is non-empty and contains clientA's text",
      memberAssignedContextA.messages.length > 0 &&
        joinedText(memberAssignedContextA).includes("mensaje 1 de client A"),
      `got ${memberAssignedContextA.messages.length} message(s): ${joinedText(memberAssignedContextA)}`,
    );

    const memberAssignedContextB = await buildAgentContext(
      agencyId,
      memberAssignedIdentity,
      { channel: "whatsapp", counterpartPhoneNumber: seeded.contactBPhone },
      toolsFor(memberAssignedIdentity),
    );
    check(
      "(3) SEG-06 PROOF: memberAssigned context for unassigned clientB's phone is empty",
      memberAssignedContextB.messages.length === 0,
      `expected 0 messages, got ${memberAssignedContextB.messages.length}`,
    );

    const contactAContext = await buildAgentContext(
      agencyId,
      contactAIdentity,
      { channel: "whatsapp", counterpartPhoneNumber: seeded.contactAPhone },
      toolsFor(contactAIdentity),
    );
    check(
      "(4) client_contact context for clientA is non-empty and excludes clientB's text",
      contactAContext.messages.length > 0 && !joinedText(contactAContext).includes("mensaje 1 de client B"),
      `got ${contactAContext.messages.length} message(s): ${joinedText(contactAContext)}`,
    );

    const contactAInternalContext = await buildAgentContext(
      agencyId,
      contactAIdentity,
      { channel: "whatsapp", counterpartPhoneNumber: seeded.memberOtherPhone },
      toolsFor(contactAIdentity),
    );
    check(
      "(5) client_contact context for the team-internal thread (a team member's phone) is empty",
      contactAInternalContext.messages.length === 0,
      `expected 0 messages, got ${contactAInternalContext.messages.length}`,
    );

    const unknownContext = await buildAgentContext(
      agencyId,
      unknownIdentity,
      { channel: "whatsapp", counterpartPhoneNumber: seeded.contactAPhone },
      toolsFor(unknownIdentity),
    );
    check(
      "(6) unknown identity context is empty, with an empty tool set",
      unknownContext.messages.length === 0 && unknownContext.tools.length === 0,
      `messages=${unknownContext.messages.length}, tools=${unknownContext.tools.length}`,
    );

    const allContexts = [
      adminContext,
      memberAssignedContextA,
      memberAssignedContextB,
      contactAContext,
      contactAInternalContext,
      unknownContext,
    ];
    check(
      "(7) SEG-09: every produced context.system contains the AI_DISCLOSURE_RULE verbatim",
      allContexts.every((c) => c.system.includes(AI_DISCLOSURE_RULE)),
      "one or more context.system strings did not contain AI_DISCLOSURE_RULE",
    );

    const contactTools = toolsFor(contactAIdentity);
    const unknownTools = toolsFor(unknownIdentity);
    const teamTools = toolsFor(adminIdentity);
    check(
      "(8) LD-06: toolsFor(client_contact) and toolsFor(unknown) are empty; toolsFor(team_member) returns exactly 2 tools",
      contactTools.length === 0 && unknownTools.length === 0 && teamTools.length === 2,
      `contact=${contactTools.length}, unknown=${unknownTools.length}, team=${teamTools.length}`,
    );

    // === SEG-10: the risk engine's two branches, against the real database ===
    console.log("\nRunning SEG-10 risk-engine assertions...");

    function buildActor(
      identity: ResolvedIdentity,
      clientId: string | null,
      counterpartPhoneNumber: string | null,
    ): TurnActor {
      return { agencyId, identity, clientId, channel: "whatsapp", counterpartPhoneNumber };
    }

    // (9)/(9b)/(9c): low-risk send_payment_reminder to clientA, from admin.
    const beforeLowRiskCall = graphCalls.length;
    const lowRiskToolUseId = `verify-agent-tool-low-${randomUUID()}`;
    const lowRiskResult = await classifyAndExecute(
      {
        id: lowRiskToolUseId,
        name: "send_payment_reminder",
        input: { clientId: seeded.clientAId, message: "Recordatorio de pago" },
      },
      buildActor(adminIdentity, null, seeded.contactAPhone),
    );
    check(
      "(9) low-risk send_payment_reminder to clientA returns a non-error tool_result",
      !lowRiskResult.is_error,
      `got ${JSON.stringify(lowRiskResult)}`,
    );
    check(
      "(9b) exactly one stubbed Graph API POST was made for the low-risk send",
      graphCalls.length === beforeLowRiskCall + 1,
      `expected ${beforeLowRiskCall + 1}, got ${graphCalls.length}`,
    );

    const outboundClientAMessages = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
      tx
        .select()
        .from(messages)
        .where(and(eq(messages.clientId, seeded!.clientAId), eq(messages.direction, "outbound"))));
    check(
      "(9c) a new outbound messages row for clientA was persisted",
      outboundClientAMessages.length === 1,
      `expected 1 row, got ${outboundClientAMessages.length}`,
    );

    const lowRiskAuditRows = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.clientId, seeded!.clientAId), eq(auditLog.actionTypeCode, "payment_reminder"))));
    check(
      "(10) exactly one audit_log row with status=executed, risk_level=low, action_type_code=payment_reminder, client_id=clientA",
      lowRiskAuditRows.length === 1 &&
        lowRiskAuditRows[0]?.status === "executed" &&
        lowRiskAuditRows[0]?.riskLevel === "low",
      `got ${JSON.stringify(lowRiskAuditRows)}`,
    );

    // (11)/(12)/(13): high-risk draft_client_content to clientA — THE SEG-10
    // PROOF that the high branch never touches the outbound side effect.
    const beforeHighRiskCall = graphCalls.length;
    const highRiskToolUseId = `verify-agent-tool-high-${randomUUID()}`;
    const highRiskInput = { clientId: seeded.clientAId, contentDraft: "Nueva propuesta de contenido" };
    await classifyAndExecute(
      { id: highRiskToolUseId, name: "draft_client_content", input: highRiskInput },
      buildActor(adminIdentity, null, seeded.contactAPhone),
    );
    check(
      "(11) SEG-10 PROOF: the high-risk draft_client_content call makes NO Graph API POST",
      graphCalls.length === beforeHighRiskCall,
      `expected ${beforeHighRiskCall}, got ${graphCalls.length}`,
    );

    const highRiskQueueRows = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
      tx.select().from(approvalQueue).where(eq(approvalQueue.toolUseId, highRiskToolUseId)));
    check(
      "(12) exactly one approval_queue row, status=pending, tool_name=draft_client_content, action_type_code=new_client_content, risk_level=high, tool_input round-trips",
      highRiskQueueRows.length === 1 &&
        highRiskQueueRows[0]?.status === "pending" &&
        highRiskQueueRows[0]?.toolName === "draft_client_content" &&
        highRiskQueueRows[0]?.actionTypeCode === "new_client_content" &&
        highRiskQueueRows[0]?.riskLevel === "high" &&
        JSON.stringify(highRiskQueueRows[0]?.toolInput) === JSON.stringify(highRiskInput),
      `got ${JSON.stringify(highRiskQueueRows)}`,
    );
    const pendingApprovalQueueId = highRiskQueueRows[0]?.id;

    const highRiskAuditRows = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.actionTypeCode, "new_client_content")));
    check(
      "(13) one audit_log row with status=pending_approval whose approval_id equals the queue row's id",
      highRiskAuditRows.length === 1 &&
        highRiskAuditRows[0]?.status === "pending_approval" &&
        highRiskAuditRows[0]?.approvalId === pendingApprovalQueueId,
      `got ${JSON.stringify(highRiskAuditRows)}`,
    );

    // (14): idempotency — a retried Inngest step must not double-queue.
    const idempotentToolUseId = `verify-agent-tool-idempotent-${randomUUID()}`;
    const idempotentCall = () =>
      classifyAndExecute(
        {
          id: idempotentToolUseId,
          name: "draft_client_content",
          input: { clientId: seeded!.clientAId, contentDraft: "Segunda propuesta" },
        },
        buildActor(adminIdentity, null, seeded!.contactAPhone),
      );
    await idempotentCall();
    await idempotentCall();
    const idempotentQueueRows = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
      tx.select().from(approvalQueue).where(eq(approvalQueue.toolUseId, idempotentToolUseId)));
    check(
      "(14) calling classifyAndExecute twice with the SAME tool_use_id produces exactly ONE approval_queue row",
      idempotentQueueRows.length === 1,
      `got ${idempotentQueueRows.length}`,
    );

    // (15): PITFALL-4/SEG-07 — a client_contact's turn can never target a
    // different client's clientId, no matter what the model proposed.
    const beforeCrossClientQueueCount = (
      await withResolvedIdentityContext(agencyId, adminIdentity, (tx) => tx.select().from(approvalQueue))
    ).length;
    const beforeCrossClientCall = graphCalls.length;
    const crossClientResult = await classifyAndExecute(
      {
        id: `verify-agent-tool-crossclient-${randomUUID()}`,
        name: "send_payment_reminder",
        input: { clientId: seeded.clientBId, message: "intento cruzado" },
      },
      buildActor(contactAIdentity, seeded.clientAId, seeded.contactAPhone),
    );
    check(
      "(15) PITFALL-4/SEG-07 PROOF: a client_contact proposing a tool call for a different client is rejected",
      crossClientResult.is_error === true,
      `got ${JSON.stringify(crossClientResult)}`,
    );
    check(
      "(15b) no Graph API POST was made for the cross-client attempt",
      graphCalls.length === beforeCrossClientCall,
      `expected ${beforeCrossClientCall}, got ${graphCalls.length}`,
    );
    const afterCrossClientQueueCount = (
      await withResolvedIdentityContext(agencyId, adminIdentity, (tx) => tx.select().from(approvalQueue))
    ).length;
    check(
      "(15c) no new approval_queue row exists after the cross-client attempt",
      afterCrossClientQueueCount === beforeCrossClientQueueCount,
      `before=${beforeCrossClientQueueCount}, after=${afterCrossClientQueueCount}`,
    );

    // (16): an unmapped (e.g. hallucinated) tool name is rejected before any
    // catalog read and before any execution.
    const beforeUnmappedQueueCount = (
      await withResolvedIdentityContext(agencyId, adminIdentity, (tx) => tx.select().from(approvalQueue))
    ).length;
    const beforeUnmappedCall = graphCalls.length;
    const unmappedResult = await classifyAndExecute(
      {
        id: `verify-agent-tool-unmapped-${randomUUID()}`,
        name: "delete_everything",
        input: { clientId: seeded.clientAId },
      },
      buildActor(adminIdentity, null, seeded.contactAPhone),
    );
    check(
      "(16) an unmapped tool name is rejected with is_error",
      unmappedResult.is_error === true,
      `got ${JSON.stringify(unmappedResult)}`,
    );
    check(
      "(16b) no Graph API POST was made for the unmapped tool",
      graphCalls.length === beforeUnmappedCall,
      `expected ${beforeUnmappedCall}, got ${graphCalls.length}`,
    );
    const afterUnmappedQueueCount = (
      await withResolvedIdentityContext(agencyId, adminIdentity, (tx) => tx.select().from(approvalQueue))
    ).length;
    check(
      "(16c) no approval_queue row was created for the unmapped tool",
      afterUnmappedQueueCount === beforeUnmappedQueueCount,
      `before=${beforeUnmappedQueueCount}, after=${afterUnmappedQueueCount}`,
    );

    // (17): SEG-04 holds even for an admin-initiated agent action — clientB's
    // only contact has NOT been attested by the team.
    const beforeOptInCall = graphCalls.length;
    const optInResult = await classifyAndExecute(
      {
        id: `verify-agent-tool-optin-${randomUUID()}`,
        name: "send_payment_reminder",
        input: { clientId: seeded.clientBId, message: "Recordatorio para B" },
      },
      buildActor(adminIdentity, null, seeded.contactAPhone),
    );
    check(
      "(17) SEG-04: send_payment_reminder to a client whose only contact has no confirmed opt-in reports the missing opt-in",
      typeof optInResult.content === "string" && optInResult.content.includes("opt-in"),
      `got ${JSON.stringify(optInResult)}`,
    );
    check(
      "(17b) no Graph API POST was made for the missing-opt-in send",
      graphCalls.length === beforeOptInCall,
      `expected ${beforeOptInCall}, got ${graphCalls.length}`,
    );

    // === approval_queue RLS (LD-04) ===
    console.log("\nRunning approval_queue RLS assertions...");
    const pendingQueueId = pendingApprovalQueueId as string;

    const adminQueueRows = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
      tx.select().from(approvalQueue).where(eq(approvalQueue.id, pendingQueueId)));
    check(
      "(18) admin scope reads the pending approval_queue row",
      adminQueueRows.length === 1,
      `got ${adminQueueRows.length}`,
    );

    const memberAssignedQueueRows = await withResolvedIdentityContext(agencyId, memberAssignedIdentity, (tx) =>
      tx.select().from(approvalQueue).where(eq(approvalQueue.id, pendingQueueId)));
    check(
      "(19) memberAssigned scope (assigned to clientA) reads the pending row",
      memberAssignedQueueRows.length === 1,
      `got ${memberAssignedQueueRows.length}`,
    );

    const memberOtherQueueRows = await withResolvedIdentityContext(agencyId, memberOtherIdentity, (tx) =>
      tx.select().from(approvalQueue).where(eq(approvalQueue.id, pendingQueueId)));
    check(
      "(20) memberOther scope (unassigned to clientA) does NOT read the pending row",
      memberOtherQueueRows.length === 0,
      `got ${memberOtherQueueRows.length}`,
    );

    const contactQueueRows = await withResolvedIdentityContext(agencyId, contactAIdentity, (tx) =>
      tx.select().from(approvalQueue));
    check(
      "(21) LD-04 PROOF: client_contact scope for clientA reads EXACTLY 0 rows from approval_queue",
      contactQueueRows.length === 0,
      `got ${contactQueueRows.length}`,
    );

    const unknownQueueRows = await withResolvedIdentityContext(agencyId, unknownIdentity, (tx) =>
      tx.select().from(approvalQueue));
    check(
      "(22) unknown scope reads 0 rows from approval_queue",
      unknownQueueRows.length === 0,
      `got ${unknownQueueRows.length}`,
    );

    const contactUpdateResult = await withResolvedIdentityContext(agencyId, contactAIdentity, (tx) =>
      tx
        .update(approvalQueue)
        .set({ status: "approved" })
        .where(eq(approvalQueue.id, pendingQueueId))
        .returning({ id: approvalQueue.id }));
    check(
      "(23) an UPDATE of approval_queue.status from a client_contact scope affects 0 rows",
      contactUpdateResult.length === 0,
      `got ${JSON.stringify(contactUpdateResult)}`,
    );

    console.log("");
    if (failures.length === 0) {
      console.log("All assertions passed.");
    } else {
      console.log(`${failures.length} assertion(s) failed:`);
      for (const f of failures) console.log(`  - ${f}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    console.log("\nCleaning up test data...");
    try {
      const cleanupIdentity: ResolvedIdentity = seeded
        ? { type: "team_member", teamMemberId: seeded.adminId, role: "admin" }
        : { type: "unknown" };
      await withResolvedIdentityContext(agencyId, cleanupIdentity, (tx) =>
        tx.delete(agencies).where(eq(agencies.id, agencyId)));
    } catch (err) {
      console.error("Cleanup of test agency failed:", err);
    }
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("verify-agent.ts crashed:", err);
  process.exitCode = 1;
});
