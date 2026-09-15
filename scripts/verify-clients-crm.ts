/**
 * Real-Neon proof of the two Wave-0 gaps this phase's own RESEARCH.md and
 * VALIDATION.md flagged as untested by a green `tsc`: (a) the RLS
 * write-policy split (plan 05-01, migration 0021) actually lets a member
 * INSERT into `clients` and lets a member UPDATE only a client assigned to
 * them, never one assigned to someone else; and (b) the risk-interceptor fix
 * (plan 05-02) actually lets `create_client`/`list_clients` through with no
 * `clientId` while `update_client`/`get_client` still reject a
 * `client_contact` targeting a foreign `clientId`. Run with
 * `npx tsx scripts/verify-clients-crm.ts` (wired as
 * `npm run db:verify-clients-crm`).
 *
 * Needs network egress to Neon and therefore cannot run in a sandboxed
 * session. Migrations 0020-0022 must already be applied — this script is NOT
 * run by this plan itself; plan 05-10 is the live-Neon checkpoint that runs
 * it (see that plan's own verification section).
 *
 * Every scope this script opens goes through the REAL tenant helpers —
 * `withResolvedIdentityContext` — and every assertion calls the REAL
 * `createClient`/`updateClient` (plan 05-03), `classifyAndExecute` (plan
 * 05-02) and `executeTool` (plan 05-04), never a reimplementation of any of
 * them. See `scripts/verify-agent-rls.ts` and `scripts/verify-agent.ts` for
 * the same posture and the seeding shape this script deliberately mirrors,
 * under a SEPARATE agency id so all three scripts can run back to back
 * without colliding.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../lib/db";
import { agencies } from "../lib/db/schema/agencies";
import { agentActionCatalog } from "../lib/db/schema/agent-action-catalog";
import { authorizedContacts } from "../lib/db/schema/authorized-contacts";
import { clientAssignments } from "../lib/db/schema/client-assignments";
import { clients } from "../lib/db/schema/clients";
import { teamMembers } from "../lib/db/schema/team-members";
import { classifyAndExecute } from "../lib/agent/risk-interceptor";
import { executeTool } from "../lib/agent/tools";
import type { TurnActor } from "../lib/agent/types";
import { createClient } from "../lib/clients/create-client";
import { updateClient } from "../lib/clients/update-client";
import type { ResolvedIdentity } from "../lib/identity/types";
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

async function main() {
  const agencyId = `verify-clients-crm-${randomUUID()}`;
  const adminPhone = `+5750${randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "0")}`;
  const memberAssignedPhone = `+5751${randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "0")}`;
  const memberOtherPhone = `+5752${randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "0")}`;
  const contactBPhone = `+5753${randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "0")}`;

  let adminId: string | undefined;

  try {
    // === Setup ===
    // Every write below opens its scope through withResolvedIdentityContext
    // — never a hand-set Postgres session variable — per
    // verify-agent-rls.ts's own contract, which this script deliberately
    // mirrors.
    console.log("Seeding test data...");

    const unknownIdentity: ResolvedIdentity = { type: "unknown" };

    await withResolvedIdentityContext(agencyId, unknownIdentity, (tx) =>
      tx.insert(agencies).values({ id: agencyId, name: "Verify Clients CRM Agency" }));

    const adminRow = await withResolvedIdentityContext(agencyId, unknownIdentity, (tx) =>
      tx
        .insert(teamMembers)
        .values({
          agencyId,
          email: "verify-clients-crm-admin@example.com",
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
          email: "verify-clients-crm-member-assigned@example.com",
          role: "member",
          status: "active",
          whatsappNumber: memberAssignedPhone,
        })
        .returning({ id: teamMembers.id }));
    const memberAssignedId = memberAssignedRow[0]?.id;

    const memberOtherRow = await withResolvedIdentityContext(agencyId, unknownIdentity, (tx) =>
      tx
        .insert(teamMembers)
        .values({
          agencyId,
          email: "verify-clients-crm-member-other@example.com",
          role: "member",
          status: "active",
          whatsappNumber: memberOtherPhone,
        })
        .returning({ id: teamMembers.id }));
    const memberOtherId = memberOtherRow[0]?.id;

    if (!adminId || !memberAssignedId || !memberOtherId) {
      throw new Error(
        `Setup failed to produce the expected team member ids (adminId=${adminId}, memberAssignedId=${memberAssignedId}, memberOtherId=${memberOtherId}).`,
      );
    }
    const seededAdminId: string = adminId;

    const adminIdentity: ResolvedIdentity = { type: "team_member", teamMemberId: seededAdminId, role: "admin" };
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

    // Client A has real phone/email so it satisfies
    // clients_contact_required_check on its own — needed because plan
    // 05-01's migration 0020 constraint is enforced even when this script
    // (not a Server Action) does the insert.
    const clientARow = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
      tx
        .insert(clients)
        .values({
          agencyId,
          name: "Client A",
          phone: "+573000000001",
          email: "clientea@example.com",
        })
        .returning({ id: clients.id }));
    const clientAId = clientARow[0]?.id;

    const clientBRow = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
      tx
        .insert(clients)
        .values({ agencyId, name: "Client B", phone: "+573000000002" })
        .returning({ id: clients.id }));
    const clientBId = clientBRow[0]?.id;

    if (!clientAId || !clientBId) {
      throw new Error(`Setup failed to produce the expected client ids (clientAId=${clientAId}, clientBId=${clientBId}).`);
    }
    const seededClientAId: string = clientAId;
    const seededClientBId: string = clientBId;

    // Client A is assigned to memberAssigned ONLY — memberOther stays
    // unassigned to anything, the load-bearing setup for group 1 below.
    await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
      tx.insert(clientAssignments).values({
        agencyId,
        clientId: seededClientAId,
        teamMemberId: memberAssignedId,
      }));

    // A client_contact identity for Client B (a DIFFERENT client than
    // Client A), with a confirmed team opt-in attestation — the load-bearing
    // setup for group 3's cross-client interceptor assertion below.
    const contactBRow = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
      tx
        .insert(authorizedContacts)
        .values({
          agencyId,
          clientId: seededClientBId,
          name: "Contact B",
          phoneNumber: contactBPhone,
          optInConfirmedByTeam: true,
          optInConfirmedBy: seededAdminId,
          optInConfirmedAt: new Date(),
        })
        .returning({ id: authorizedContacts.id }));
    const contactBId = contactBRow[0]?.id;

    if (!contactBId) {
      throw new Error(`Setup failed to produce the expected contact id (contactBId=${contactBId}).`);
    }
    const seededContactBId: string = contactBId;

    const contactBIdentity: ResolvedIdentity = {
      type: "client_contact",
      contactId: seededContactBId,
      clientId: seededClientBId,
      optInConfirmedByTeam: true,
    };

    console.log(
      `Seeded: agency=${agencyId} (admin=${seededAdminId}, memberAssigned=${memberAssignedId}, memberOther=${memberOtherId}, clientA=${seededClientAId}, clientB=${seededClientBId}, contactB=${seededContactBId})\n`,
    );

    function buildActor(
      identity: ResolvedIdentity,
      clientId: string | null,
      counterpartPhoneNumber: string | null,
    ): TurnActor {
      return { agencyId, identity, clientId, channel: "whatsapp", counterpartPhoneNumber };
    }

    // === Group 1: RLS write split (plan 05-01) ===
    console.log("Running RLS write-split assertions (plan 05-01)...");

    // Goes through the REAL createClient(), not a raw insert: a raw
    // `INSERT ... RETURNING` here would fail RLS for a different reason than
    // the one this assertion is checking — Postgres re-checks RETURNING
    // against the SELECT policy, and memberOther has no client_assignments
    // row yet for a client that doesn't exist until this statement runs.
    // createClient() sidesteps this by generating the id itself and not
    // using RETURNING; see its own comment for the full explanation.
    const memberOtherCreateResult = await createClient({
      agencyId,
      identity: memberOtherIdentity,
      input: { name: "Direct Insert By Member Other", phone: "+573000000099" },
    });
    check(
      "(1) D-13 PROOF: clients_insert_by_team_member lets memberOther (any team member) create a client via the real createClient()",
      memberOtherCreateResult.success,
      `expected success, got ${JSON.stringify(memberOtherCreateResult)}`,
    );

    const memberOtherUpdateAttempt = await withResolvedIdentityContext(agencyId, memberOtherIdentity, (tx) =>
      tx
        .update(clients)
        .set({ notes: "intento no autorizado" })
        .where(eq(clients.id, seededClientAId))
        .returning({ id: clients.id }));
    check(
      "(2) memberOther (unassigned to Client A) UPDATE on Client A affects 0 rows",
      memberOtherUpdateAttempt.length === 0,
      `expected 0 rows, got ${JSON.stringify(memberOtherUpdateAttempt)}`,
    );

    const memberAssignedUpdateAttempt = await withResolvedIdentityContext(agencyId, memberAssignedIdentity, (tx) =>
      tx
        .update(clients)
        .set({ notes: "actualizado por memberAssigned" })
        .where(eq(clients.id, seededClientAId))
        .returning({ id: clients.id }));
    check(
      "(3) memberAssigned (assigned to Client A) UPDATE on Client A succeeds",
      memberAssignedUpdateAttempt.length === 1,
      `expected 1 row, got ${JSON.stringify(memberAssignedUpdateAttempt)}`,
    );

    const adminUpdateAttempt = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
      tx
        .update(clients)
        .set({ notes: "actualizado por admin" })
        .where(eq(clients.id, seededClientAId))
        .returning({ id: clients.id }));
    check(
      "(4) admin UPDATE on Client A succeeds regardless of assignment",
      adminUpdateAttempt.length === 1,
      `expected 1 row, got ${JSON.stringify(adminUpdateAttempt)}`,
    );

    // === Group 2: createClient/updateClient (plan 05-03), agent-facing functions ===
    console.log("\nRunning createClient/updateClient service-layer assertions (plan 05-03)...");

    const selfAssignResult = await createClient({
      agencyId,
      identity: memberOtherIdentity,
      input: { name: "Cliente Via Service Member Other", phone: "+573000000100" },
    });
    check(
      "(5) createClient by memberOther succeeds",
      selfAssignResult.success === true,
      `got ${JSON.stringify(selfAssignResult)}`,
    );

    if (selfAssignResult.success) {
      const newClientId = selfAssignResult.clientId;
      const memberOtherOwnReadRows = await withResolvedIdentityContext(agencyId, memberOtherIdentity, (tx) =>
        tx.select({ id: clients.id }).from(clients).where(eq(clients.id, newClientId)));
      check(
        "(6) D-13 PROOF: memberOther can see the client they just created (self-assignment)",
        memberOtherOwnReadRows.length === 1,
        `expected 1 row, got ${JSON.stringify(memberOtherOwnReadRows)}`,
      );
    } else {
      check("(6) D-13 PROOF: memberOther can see the client they just created (self-assignment)", false, "skipped — createClient did not report success");
    }

    const duplicateFirstCall = await createClient({
      agencyId,
      identity: memberOtherIdentity,
      input: { name: "Cliente Duplicado", phone: "+573000000101" },
    });
    check(
      "(7) first createClient call for a fresh name reports duplicateWarning=null",
      duplicateFirstCall.success === true && duplicateFirstCall.duplicateWarning === null,
      `got ${JSON.stringify(duplicateFirstCall)}`,
    );

    const duplicateSecondCall = await createClient({
      agencyId,
      identity: memberOtherIdentity,
      input: { name: "Cliente Duplicado", phone: "+573000000102" },
    });
    check(
      "(8) D-09 PROOF: second createClient call with the identical name reports a non-null duplicateWarning",
      duplicateSecondCall.success === true && duplicateSecondCall.duplicateWarning !== null,
      `got ${JSON.stringify(duplicateSecondCall)}`,
    );

    const contactRequiredResult = await createClient({
      agencyId,
      identity: memberOtherIdentity,
      input: { name: "Cliente Sin Contacto Servicio" },
    });
    check(
      "(9) createClient called directly with neither phone nor email rejects with contactRequired",
      contactRequiredResult.success === false && contactRequiredResult.error === "contactRequired",
      `got ${JSON.stringify(contactRequiredResult)}`,
    );

    const partialUpdateResult = await updateClient({
      agencyId,
      identity: memberAssignedIdentity,
      clientId: seededClientAId,
      input: { notes: "nueva nota" },
    });
    check(
      "(10) updateClient by memberAssigned with a partial patch ({notes}) succeeds",
      partialUpdateResult.success === true,
      `got ${JSON.stringify(partialUpdateResult)}`,
    );

    const clientAAfterPartialUpdate = await withResolvedIdentityContext(agencyId, adminIdentity, (tx) =>
      tx.select().from(clients).where(eq(clients.id, seededClientAId)));
    check(
      "(11) merge-not-replace PROOF: Client A's phone/email are UNCHANGED after the {notes}-only patch",
      clientAAfterPartialUpdate[0]?.phone === "+573000000001" &&
        clientAAfterPartialUpdate[0]?.email === "clientea@example.com" &&
        clientAAfterPartialUpdate[0]?.notes === "nueva nota",
      `got ${JSON.stringify(clientAAfterPartialUpdate[0])}`,
    );

    const memberOtherUpdateServiceAttempt = await updateClient({
      agencyId,
      identity: memberOtherIdentity,
      clientId: seededClientAId,
      input: { notes: "intento no autorizado via servicio" },
    });
    check(
      "(12) updateClient by memberOther (unassigned) targeting Client A rejects with notFound",
      memberOtherUpdateServiceAttempt.success === false && memberOtherUpdateServiceAttempt.error === "notFound",
      `got ${JSON.stringify(memberOtherUpdateServiceAttempt)}`,
    );

    // === Group 3: interceptor (plan 05-02) ===
    console.log("\nRunning classifyAndExecute interceptor assertions (plan 05-02)...");

    const createClientToolUseId = `verify-clients-crm-tool-create-${randomUUID()}`;
    const createClientInterceptorResult = await classifyAndExecute(
      {
        id: createClientToolUseId,
        name: "create_client",
        input: { name: "Cliente Interceptor", phone: "+573000000201" },
      },
      buildActor(memberOtherIdentity, null, memberOtherPhone),
    );
    check(
      "(13) INTERCEPTOR PROOF: create_client with no clientId is NOT rejected (conditional clientId fix)",
      createClientInterceptorResult.is_error !== true,
      `got ${JSON.stringify(createClientInterceptorResult)}`,
    );

    const listClientsToolUseId = `verify-clients-crm-tool-list-${randomUUID()}`;
    const listClientsInterceptorResult = await classifyAndExecute(
      { id: listClientsToolUseId, name: "list_clients", input: {} },
      buildActor(memberOtherIdentity, null, memberOtherPhone),
    );
    check(
      "(14) INTERCEPTOR PROOF: list_clients with no clientId is NOT rejected (conditional clientId fix)",
      listClientsInterceptorResult.is_error !== true,
      `got ${JSON.stringify(listClientsInterceptorResult)}`,
    );

    const updateClientCrossToolUseId = `verify-clients-crm-tool-update-cross-${randomUUID()}`;
    const updateClientCrossResult = await classifyAndExecute(
      {
        id: updateClientCrossToolUseId,
        name: "update_client",
        input: { clientId: seededClientAId, notes: "intento cruzado" },
      },
      buildActor(contactBIdentity, seededClientBId, contactBPhone),
    );
    check(
      "(15) SEG-07 PROOF: update_client stayed CLIENT_SCOPED — a client_contact of Client B targeting Client A is rejected",
      updateClientCrossResult.is_error === true,
      `got ${JSON.stringify(updateClientCrossResult)}`,
    );

    const getClientCrossToolUseId = `verify-clients-crm-tool-get-cross-${randomUUID()}`;
    const getClientCrossResult = await classifyAndExecute(
      {
        id: getClientCrossToolUseId,
        name: "get_client",
        input: { clientId: seededClientAId },
      },
      buildActor(contactBIdentity, seededClientBId, contactBPhone),
    );
    check(
      "(16) SEG-07 PROOF: get_client stayed CLIENT_SCOPED — a client_contact of Client B targeting Client A is rejected",
      getClientCrossResult.is_error === true,
      `got ${JSON.stringify(getClientCrossResult)}`,
    );

    // === Group 4: create_client tool D-07/D-09 (plan 05-04), via executeTool directly ===
    console.log("\nRunning create_client tool D-07/D-09 assertions (plan 05-04)...");

    const memberActor = buildActor(memberOtherIdentity, null, memberOtherPhone);

    const askBackResult = await executeTool("create_client", { name: "Sin Contacto" }, memberActor);
    check(
      "(17) D-07 PROOF: create_client tool asks back for contact info instead of calling createClient",
      askBackResult === "Falta un dato de contacto: pide teléfono o correo antes de crear el cliente.",
      `got ${JSON.stringify(askBackResult)}`,
    );

    const noRowForAskBack = await withResolvedIdentityContext(agencyId, memberOtherIdentity, (tx) =>
      tx.select({ id: clients.id }).from(clients).where(eq(clients.name, "Sin Contacto")));
    check(
      "(18) D-07 PROOF: no clients row named 'Sin Contacto' was created by the ask-back call",
      noRowForAskBack.length === 0,
      `expected 0 rows, got ${JSON.stringify(noRowForAskBack)}`,
    );

    const duplicateToolResult = await executeTool(
      "create_client",
      { name: "Client A", phone: "+573000000202" },
      memberActor,
    );
    check(
      "(19) D-09 PROOF: create_client tool relays the duplicate-name warning for a name matching seeded Client A",
      typeof duplicateToolResult === "string" && duplicateToolResult.includes("Ya existe un cliente llamado"),
      `got ${JSON.stringify(duplicateToolResult)}`,
    );

    // === Group 5: catalog classification (D-08/D-17) ===
    console.log("\nRunning agent_action_catalog assertions (migration 0022)...");

    const catalogRows = await db
      .select({ code: agentActionCatalog.code, riskLevel: agentActionCatalog.riskLevel })
      .from(agentActionCatalog)
      .where(inArray(agentActionCatalog.code, ["create_client", "update_client", "list_clients", "get_client"]));
    check(
      "(20) all 4 new agent_action_catalog codes exist, all risk_level=low",
      catalogRows.length === 4 && catalogRows.every((row) => row.riskLevel === "low"),
      `got ${JSON.stringify(catalogRows)}`,
    );

    console.log("");
    if (failures.length === 0) {
      console.log("All assertions passed.");
    } else {
      console.log(`${failures.length} assertion(s) failed:`);
      for (const f of failures) console.log(`  - ${f}`);
    }
  } finally {
    // Same tolerant-cleanup convention as verify-agent-rls.ts /
    // verify-agent.ts: deleting the seeded agency cascades into audit_log
    // (written by every low-risk classifyAndExecute/executeTool call above),
    // and 0014's REVOKE DELETE on audit_log FROM app_user means that cascade
    // is expected to throw "permission denied for table audit_log". Caught
    // and logged, not thrown — this run leaves one orphaned test agency
    // behind, exactly like the two scripts it mirrors.
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
  console.error("verify-clients-crm.ts crashed:", err);
  process.exitCode = 1;
});
