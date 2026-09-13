/**
 * Real-Neon half of Phase 3's test matrix — the network-free half is
 * `verify-whatsapp-webhook-parsing.ts` and `verify-whatsapp-send.ts`. Run
 * with `npx tsx scripts/verify-whatsapp-webhook.ts` (wired as
 * `npm run db:verify-whatsapp` by plan 03-02).
 *
 * Calls the REAL production functions — `findAgencyByTeamWhatsAppNumber`,
 * `resolveInboundAgency`, `ingestInboundMessage`, `recordDeliveryStatus`,
 * `withSystemWebhookContext`, `withResolvedIdentityContext` — never a
 * reimplementation. The proof this script produces is that Postgres RLS,
 * not application code, confines each actor; see verify-rls-isolation.ts
 * and verify-identity-resolution.ts for the same posture in earlier phases.
 *
 * Needs network egress to Neon and therefore cannot run in a sandboxed
 * session. Migrations 0012 and 0013 must already be applied.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { agencies } from "../lib/db/schema/agencies";
import { authorizedContacts } from "../lib/db/schema/authorized-contacts";
import { clients } from "../lib/db/schema/clients";
import { messages } from "../lib/db/schema/messages";
import { teamMembers } from "../lib/db/schema/team-members";
import type { ResolvedIdentity } from "../lib/identity/types";
import {
  findAgencyByTeamWhatsAppNumber,
} from "../lib/whatsapp/find-agency-by-whatsapp-number";
import { ingestInboundMessage } from "../lib/whatsapp/ingest-inbound-message";
import { recordDeliveryStatus } from "../lib/whatsapp/record-delivery-status";
import {
  resetAgencyNumberMapCache,
  resolveInboundAgency,
} from "../lib/whatsapp/resolve-inbound-agency";
import { withSystemWebhookContext } from "../lib/tenant/with-system-webhook-context";
import { withResolvedIdentityContext } from "../lib/tenant/with-resolved-identity-context";

const failures: string[] = [];

function check(label: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`  [PASS] ${label}`);
  } else {
    console.log(`  [FAIL] ${label} — ${detail}`);
    failures.push(`${label} — ${detail}`);
  }
}

function assertRowCount(label: string, rows: unknown[], expected: number) {
  check(
    label,
    rows.length === expected,
    `expected ${expected} row(s), got ${rows.length} (${JSON.stringify(rows)})`,
  );
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

/* eslint-disable @typescript-eslint/no-explicit-any -- db.batch()'s tuple
   typing can't express "an array built up dynamically per scenario"; every
   value pulled out of its result is immediately used in a runtime assertion
   below, which is the actual correctness check, not these types. */
async function batch(queries: unknown[]): Promise<any[]> {
  return (db.batch as any)(queries);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Reads messages for an agency through the admin branch of messages_select_by_role. */
async function selectMessagesAsAdmin(agencyId: string) {
  const rows = await batch([
    db.execute(sql`SELECT set_config('app.agency_id', ${agencyId}, true)`),
    db.execute(sql`SELECT set_config('app.role', 'admin', true)`),
    db.select().from(messages),
  ]);
  return rows[2] as (typeof messages.$inferSelect)[];
}

async function main() {
  const suffix = randomUUID().replace(/\D/g, "").slice(0, 7).padEnd(7, "0");
  const TEAM_PHONE = `+5730${suffix}`;
  const CONTACT_PHONE = `+5731${suffix}`;
  const STRANGER_PHONE = `+5732${suffix}`;
  const SHARED_PNID = `verify-shared-${randomUUID()}`;
  const AGENCY_PNID = `verify-agency-${randomUUID()}`;

  const agencyAId = `verify-whatsapp-agency-a-${randomUUID()}`;
  const agencyBId = `verify-whatsapp-agency-b-${randomUUID()}`;

  let clientA1Id: string | undefined;
  let teamMemberId: string | undefined;
  let contactId: string | undefined;

  try {
    // === Setup ===
    console.log("Seeding test data...");

    await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyAId}, true)`),
      db.insert(agencies).values({ id: agencyAId, name: "Verify WhatsApp Agency A" }),
    ]);
    await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyBId}, true)`),
      db.insert(agencies).values({ id: agencyBId, name: "Verify WhatsApp Agency B" }),
    ]);

    const clientSetup = await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyAId}, true)`),
      db.execute(sql`SELECT set_config('app.role', 'admin', true)`),
      db.insert(clients).values({ agencyId: agencyAId, name: "Client A1" }).returning({ id: clients.id }),
    ]);
    clientA1Id = clientSetup[2]?.[0]?.id;

    const teamMemberSetup = await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyAId}, true)`),
      db
        .insert(teamMembers)
        .values({
          agencyId: agencyAId,
          email: "verify-whatsapp-member@example.com",
          role: "admin",
          status: "active",
          whatsappNumber: TEAM_PHONE,
        })
        .returning({ id: teamMembers.id }),
    ]);
    teamMemberId = teamMemberSetup[1]?.[0]?.id;

    if (!clientA1Id || !teamMemberId) {
      throw new Error(
        `Setup failed to produce the expected seed row ids (clientA1Id=${clientA1Id}, teamMemberId=${teamMemberId}).`,
      );
    }

    const contactSetup = await batch([
      db.execute(sql`SELECT set_config('app.agency_id', ${agencyAId}, true)`),
      db.execute(sql`SELECT set_config('app.role', 'admin', true)`),
      db
        .insert(authorizedContacts)
        .values({
          agencyId: agencyAId,
          clientId: clientA1Id,
          name: "Contact A1",
          phoneNumber: CONTACT_PHONE,
          optInConfirmedByTeam: true,
          optInConfirmedBy: teamMemberId,
          optInConfirmedAt: new Date(),
        })
        .returning({ id: authorizedContacts.id }),
    ]);
    contactId = contactSetup[2]?.[0]?.id;

    if (!contactId) {
      throw new Error(`Setup failed to produce the expected contact row id (contactId=${contactId}).`);
    }

    console.log(
      `Seeded: agency A=${agencyAId} (client A1=${clientA1Id}, team member=${teamMemberId}, contact=${contactId}), agency B=${agencyBId} (empty)\n`,
    );

    // Test-harness configuration standing in for what WA-02's Embedded
    // Signup will persist in the database once Meta approves business
    // verification — a test-harness configuration of the real production
    // code path, not a separate code path.
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = SHARED_PNID;
    process.env.META_AGENCY_PHONE_NUMBER_MAP = JSON.stringify({ [AGENCY_PNID]: agencyAId });
    resetAgencyNumberMapCache();

    // === Cross-agency lookup (WA-04) ===
    console.log("Running cross-agency lookup assertions...");

    const foundAgency = await findAgencyByTeamWhatsAppNumber(TEAM_PHONE);
    check("(1) findAgencyByTeamWhatsAppNumber resolves the team's own agency", foundAgency === agencyAId, `got ${foundAgency}`);

    const notFoundAgency = await findAgencyByTeamWhatsAppNumber(STRANGER_PHONE);
    check("(2) findAgencyByTeamWhatsAppNumber returns null for an unregistered number", notFoundAgency === null, `got ${notFoundAgency}`);

    const funcRows = await db.execute<{
      prosecdef: boolean;
      result_type: string;
      def: string;
    }>(
      sql`select prosecdef, pg_get_function_result(oid) as result_type, pg_get_functiondef(oid) as def from pg_proc where proname = 'find_agency_by_team_whatsapp_number'`,
    );
    const funcRow = (Array.isArray(funcRows) ? funcRows : (funcRows as { rows?: unknown[] }).rows ?? [])[0] as
      | { prosecdef: boolean; result_type: string; def: string }
      | undefined;
    check(
      "(3) T-03-04: find_agency_by_team_whatsapp_number is SECURITY DEFINER returning a single text scalar with no role/email/RETURNS TABLE",
      funcRow?.prosecdef === true &&
        funcRow?.result_type === "text" &&
        funcRow.def.includes("search_path") &&
        !funcRow.def.includes("role") &&
        !funcRow.def.includes("email") &&
        !funcRow.def.includes("RETURNS TABLE"),
      `got ${JSON.stringify(funcRow)}`,
    );

    await expectThrows(
      "(4) T-03-10: a second team member in agency B with the same WhatsApp number is rejected",
      () =>
        batch([
          db.execute(sql`SELECT set_config('app.agency_id', ${agencyBId}, true)`),
          db.insert(teamMembers).values({
            agencyId: agencyBId,
            email: "verify-whatsapp-collision@example.com",
            role: "admin",
            status: "active",
            whatsappNumber: TEAM_PHONE,
          }),
        ]),
      "team_members_whatsapp_number_global_idx",
    );

    // === Routing (WA-03/WA-04) ===
    console.log("\nRunning routing assertions...");

    const sharedTeam = await resolveInboundAgency(SHARED_PNID, TEAM_PHONE);
    check(
      "(5) resolveInboundAgency: shared number + team phone -> shared_internal",
      sharedTeam.kind === "shared_internal" && sharedTeam.agencyId === agencyAId,
      `got ${JSON.stringify(sharedTeam)}`,
    );

    const sharedStranger = await resolveInboundAgency(SHARED_PNID, STRANGER_PHONE);
    check(
      "(6) resolveInboundAgency: shared number + stranger -> no_agency (unknown_sender_on_shared_number)",
      sharedStranger.kind === "no_agency" && sharedStranger.reason === "unknown_sender_on_shared_number",
      `got ${JSON.stringify(sharedStranger)}`,
    );

    const agencyNumberStranger = await resolveInboundAgency(AGENCY_PNID, STRANGER_PHONE);
    check(
      "(7) resolveInboundAgency: agency-owned number + stranger -> agency_number (destination decides)",
      agencyNumberStranger.kind === "agency_number" && agencyNumberStranger.agencyId === agencyAId,
      `got ${JSON.stringify(agencyNumberStranger)}`,
    );

    const unmapped = await resolveInboundAgency("not-a-configured-id", TEAM_PHONE);
    check(
      "(8) resolveInboundAgency: unmapped phone_number_id -> no_agency (unmapped_phone_number_id)",
      unmapped.kind === "no_agency" && unmapped.reason === "unmapped_phone_number_id",
      `got ${JSON.stringify(unmapped)}`,
    );

    // === Ingestion and identity (D-04) ===
    console.log("\nRunning ingestion assertions...");

    const teamMetaId = `verify-msg-team-${randomUUID()}`;
    const teamIngest = await ingestInboundMessage(
      { kind: "text", from: TEAM_PHONE, metaMessageId: teamMetaId, timestamp: null, text: "hola equipo" },
      SHARED_PNID,
      SHARED_PNID,
    );
    check(
      "(9a) ingestInboundMessage: team-member text message is ingested",
      teamIngest.outcome === "ingested" && teamIngest.agencyId === agencyAId,
      `got ${JSON.stringify(teamIngest)}`,
    );
    const teamRows = await selectMessagesAsAdmin(agencyAId);
    const teamRow = teamRows.find((r) => r.metaMessageId === teamMetaId);
    check(
      "(9b) ingested team-member row has the expected identity/type/content fields",
      teamRow?.resolvedIdentityType === "team_member" &&
        teamRow.resolvedIdentityId === teamMemberId &&
        teamRow.clientId === null &&
        teamRow.direction === "inbound" &&
        teamRow.channel === "whatsapp" &&
        teamRow.textBody === "hola equipo",
      `got ${JSON.stringify(teamRow)}`,
    );

    const duplicateIngest = await ingestInboundMessage(
      { kind: "text", from: TEAM_PHONE, metaMessageId: teamMetaId, timestamp: null, text: "hola equipo" },
      SHARED_PNID,
      SHARED_PNID,
    );
    check(
      "(10a) D-04/T-03-03: re-ingesting the same meta_message_id returns duplicate",
      duplicateIngest.outcome === "duplicate",
      `got ${JSON.stringify(duplicateIngest)}`,
    );
    const dupCountRows = await selectMessagesAsAdmin(agencyAId);
    const dupCount = dupCountRows.filter((r) => r.metaMessageId === teamMetaId).length;
    check("(10b) exactly one row exists for that meta_message_id", dupCount === 1, `got ${dupCount}`);

    const contactMetaId = `verify-msg-contact-${randomUUID()}`;
    const contactIngest = await ingestInboundMessage(
      { kind: "text", from: CONTACT_PHONE, metaMessageId: contactMetaId, timestamp: null, text: "hola desde el cliente" },
      AGENCY_PNID,
      AGENCY_PNID,
    );
    check(
      "(11) ingestInboundMessage: client-contact message resolves to client_contact scoped to client A1",
      contactIngest.outcome === "ingested" &&
        contactIngest.identity.type === "client_contact" &&
        contactIngest.identity.clientId === clientA1Id &&
        contactIngest.identity.contactId === contactId,
      `got ${JSON.stringify(contactIngest)}`,
    );

    const strangerAgencyMetaId = `verify-msg-stranger-agency-${randomUUID()}`;
    const strangerAgencyIngest = await ingestInboundMessage(
      { kind: "text", from: STRANGER_PHONE, metaMessageId: strangerAgencyMetaId, timestamp: null, text: "quien eres" },
      AGENCY_PNID,
      AGENCY_PNID,
    );
    check(
      "(12a) D-04: unknown sender on a known agency number is still ingested",
      strangerAgencyIngest.outcome === "ingested",
      `got ${JSON.stringify(strangerAgencyIngest)}`,
    );
    const strangerRows = await selectMessagesAsAdmin(agencyAId);
    const strangerRow = strangerRows.find((r) => r.metaMessageId === strangerAgencyMetaId);
    check(
      "(12b) unknown-sender row has resolved_identity_type=unknown, null identity id and null client id",
      strangerRow?.resolvedIdentityType === "unknown" &&
        strangerRow.resolvedIdentityId === null &&
        strangerRow.clientId === null,
      `got ${JSON.stringify(strangerRow)}`,
    );

    const countBeforeNoAgency = (await selectMessagesAsAdmin(agencyAId)).length +
      (await selectMessagesAsAdmin(agencyBId)).length;
    const noAgencyIngest = await ingestInboundMessage(
      { kind: "text", from: STRANGER_PHONE, metaMessageId: `verify-msg-noagency-${randomUUID()}`, timestamp: null, text: "hola" },
      SHARED_PNID,
      SHARED_PNID,
    );
    check(
      "(13a) resolveInboundAgency no_agency: stranger on the shared number is not ingested",
      noAgencyIngest.outcome === "no_agency",
      `got ${JSON.stringify(noAgencyIngest)}`,
    );
    const countAfterNoAgency = (await selectMessagesAsAdmin(agencyAId)).length +
      (await selectMessagesAsAdmin(agencyBId)).length;
    check(
      "(13b) message count across both agencies is unchanged by the no_agency call",
      countAfterNoAgency === countBeforeNoAgency,
      `before=${countBeforeNoAgency}, after=${countAfterNoAgency}`,
    );

    const mediaMetaId = `verify-msg-media-${randomUUID()}`;
    const mediaIngest = await ingestInboundMessage(
      {
        kind: "media",
        from: TEAM_PHONE,
        metaMessageId: mediaMetaId,
        timestamp: null,
        mediaType: "image",
        mediaId: "verify-media-id-123",
        mimeType: "image/jpeg",
      },
      SHARED_PNID,
      SHARED_PNID,
    );
    check("(14a) D-05: an image message is ingested", mediaIngest.outcome === "ingested", `got ${JSON.stringify(mediaIngest)}`);
    const mediaRows = await selectMessagesAsAdmin(agencyAId);
    const mediaRow = mediaRows.find((r) => r.metaMessageId === mediaMetaId);
    check(
      "(14b) D-05: image row stores message_type=image, media_id/mime populated, text_body null",
      mediaRow?.messageType === "image" &&
        mediaRow.mediaId === "verify-media-id-123" &&
        mediaRow.mediaMimeType === "image/jpeg" &&
        mediaRow.textBody === null,
      `got ${JSON.stringify(mediaRow)}`,
    );

    // === RLS (T-03-05 / SEG-12, T-03-18) ===
    console.log("\nRunning RLS boundary assertions...");

    const unknownScopeRows = await withResolvedIdentityContext(agencyAId, { type: "unknown" }, async (tx) =>
      tx.select().from(messages));
    assertRowCount(
      "(15) T-03-05/SEG-12: an unknown identity's resolved scope reads zero rows from messages",
      unknownScopeRows,
      0,
    );

    const adminScopeRows = await withResolvedIdentityContext(
      agencyAId,
      { type: "team_member", teamMemberId, role: "admin" },
      async (tx) => tx.select().from(messages),
    );
    check(
      "(16) an admin team-member's resolved scope reads the seeded agency-A rows",
      adminScopeRows.length > 0,
      `got ${adminScopeRows.length} rows`,
    );

    const agencyBSystemRows = await withSystemWebhookContext(agencyBId, async (tx) => tx.select().from(messages));
    assertRowCount(
      "(17) T-03-18: agency B's system-webhook scope reads zero of agency A's rows",
      agencyBSystemRows,
      0,
    );

    const clientContactIdentity: ResolvedIdentity = {
      type: "client_contact",
      contactId,
      clientId: clientA1Id,
      optInConfirmedByTeam: true,
    };
    const contactScopeRows = await withResolvedIdentityContext(agencyAId, clientContactIdentity, async (tx) =>
      tx.select().from(messages));
    check(
      "(18) a client-contact's resolved scope reads only rows scoped to its own client",
      contactScopeRows.length > 0 && contactScopeRows.every((r) => r.clientId === clientA1Id),
      `got client_ids ${JSON.stringify(contactScopeRows.map((r) => r.clientId))}`,
    );

    // === WA-07 pricing backfill ===
    console.log("\nRunning WA-07 pricing backfill assertions...");

    const outboundMetaId = `verify-msg-outbound-${randomUUID()}`;
    await withSystemWebhookContext(agencyAId, async (tx) => {
      await tx.insert(messages).values({
        agencyId: agencyAId,
        clientId: null,
        direction: "outbound",
        channel: "whatsapp",
        fromPhoneNumber: SHARED_PNID,
        toPhoneNumber: TEAM_PHONE,
        metaMessageId: outboundMetaId,
        resolvedIdentityType: "team_member",
        resolvedIdentityId: teamMemberId,
        messageType: "text",
        textBody: "Mensaje recibido",
      });
    });

    const deliveredResult = await recordDeliveryStatus(
      {
        metaMessageId: outboundMetaId,
        recipientPhoneNumber: TEAM_PHONE,
        status: "delivered",
        conversationId: "conv-verify",
        pricingCategory: "service",
        pricingBillable: false,
      },
      SHARED_PNID,
    );
    check("(19a) recordDeliveryStatus returns updated for a known meta_message_id", deliveredResult === "updated", `got ${deliveredResult}`);
    const outboundRowsAfterDelivered = await selectMessagesAsAdmin(agencyAId);
    const outboundRow = outboundRowsAfterDelivered.find((r) => r.metaMessageId === outboundMetaId);
    check(
      "(19b) delivery status, conversation id and pricing are backfilled onto the outbound row",
      outboundRow?.deliveryStatus === "delivered" &&
        outboundRow.conversationId === "conv-verify" &&
        outboundRow.pricingCategory === "service" &&
        outboundRow.pricingBillable === false,
      `got ${JSON.stringify(outboundRow)}`,
    );

    const noMatchResult = await recordDeliveryStatus(
      {
        metaMessageId: `verify-msg-nonexistent-${randomUUID()}`,
        recipientPhoneNumber: TEAM_PHONE,
        status: "delivered",
        conversationId: null,
        pricingCategory: null,
        pricingBillable: null,
      },
      SHARED_PNID,
    );
    check("(20) recordDeliveryStatus returns no_match for an unknown meta_message_id", noMatchResult === "no_match", `got ${noMatchResult}`);

    const readResult = await recordDeliveryStatus(
      {
        metaMessageId: outboundMetaId,
        recipientPhoneNumber: TEAM_PHONE,
        status: "read",
        conversationId: null,
        pricingCategory: null,
        pricingBillable: null,
      },
      SHARED_PNID,
    );
    check("(21a) a follow-up status update returns updated", readResult === "updated", `got ${readResult}`);
    const outboundRowsAfterRead = await selectMessagesAsAdmin(agencyAId);
    const outboundRowAfterRead = outboundRowsAfterRead.find((r) => r.metaMessageId === outboundMetaId);
    check(
      "(21b) a null-pricing follow-up status changes delivery_status but leaves previously recorded pricing intact",
      outboundRowAfterRead?.deliveryStatus === "read" &&
        outboundRowAfterRead.conversationId === "conv-verify" &&
        outboundRowAfterRead.pricingCategory === "service" &&
        outboundRowAfterRead.pricingBillable === false,
      `got ${JSON.stringify(outboundRowAfterRead)}`,
    );

    console.log("");
    if (failures.length === 0) {
      console.log("All assertions passed.");
    } else {
      console.log(`${failures.length} assertion(s) failed:`);
      for (const f of failures) console.log(`  - ${f}`);
    }
  } finally {
    console.log("\nCleaning up test data...");
    try {
      await batch([
        db.execute(sql`SELECT set_config('app.agency_id', ${agencyAId}, true)`),
        db.execute(sql`SELECT set_config('app.role', 'admin', true)`),
        db.delete(agencies).where(eq(agencies.id, agencyAId)),
      ]);
    } catch (err) {
      console.error("Cleanup of agency A failed:", err);
    }
    try {
      await batch([
        db.execute(sql`SELECT set_config('app.agency_id', ${agencyBId}, true)`),
        db.execute(sql`SELECT set_config('app.role', 'admin', true)`),
        db.delete(agencies).where(eq(agencies.id, agencyBId)),
      ]);
    } catch (err) {
      console.error("Cleanup of agency B failed:", err);
    }
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("verify-whatsapp-webhook.ts crashed:", err);
  process.exitCode = 1;
});
