import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agencies } from "./agencies";
import { clients } from "./clients";
import { teamMembers } from "./team-members";

/**
 * A person at a client company authorized to talk to the agency's agent over
 * WhatsApp (D-05). First table in the schema holding THIRD-PARTY personal
 * data (name, phone, email) rather than agency/team data — see STATE.md's
 * open item "Confirmar residencia de datos en Colombia (Ley 1581/Habeas
 * Data)". That legal question is not resolved here; this is the table it
 * concerns.
 *
 * Uniqueness (D-08 / SEG-02): `(agency_id, phone_number)` is unique, so one
 * phone number maps to exactly one client within an agency. A client may
 * have many contacts; a contact may not span clients. The friendly "already
 * belongs to client X" message comes from migration 0006's trigger and from
 * lib/clients/manage-authorized-contacts.ts; this index is the hard backstop.
 *
 * Opt-in (D-03 / SEG-04): `opt_in_confirmed_by_team` is the team's OWN manual
 * attestation (mandatory checkbox, unchecked by default) — deliberately NOT
 * named `opt_in_confirmed`, because it is not a Meta-verified WhatsApp opt-in
 * round-trip (RESEARCH.md Pitfall 3 / PITFALLS.md #2). Per D-04 it gates
 * PROACTIVE agent messages only; an inbound message from an unconfirmed
 * contact still resolves and is still answered.
 */
export const authorizedContacts = pgTable(
  "authorized_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: text("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // E.164-ish, validated in application code with the same regex
    // lib/team/invite-member.ts uses. Full validation is deferred to Phase
    // 3's Meta integration — the same call already made for
    // team_members.whatsapp_number.
    phoneNumber: text("phone_number").notNull(),
    email: text("email"),
    // The contact's role AT THE CLIENT ("dueño", "asistente") — not a Genzia
    // permission role. Nullable: the team may not know it at intake time.
    contactRole: text("contact_role"),
    optInConfirmedByTeam: boolean("opt_in_confirmed_by_team")
      .notNull()
      .default(false),
    optInConfirmedBy: uuid("opt_in_confirmed_by").references(
      () => teamMembers.id,
      { onDelete: "set null" },
    ),
    optInConfirmedAt: timestamp("opt_in_confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("authorized_contacts_agency_id_phone_number_idx").on(
      table.agencyId,
      table.phoneNumber,
    ),
    // D-03's "se guarda quién confirmó y cuándo" as a DB invariant.
    check(
      "authorized_contacts_opt_in_consistency_check",
      sql`(${table.optInConfirmedByTeam} = false) or (${table.optInConfirmedBy} is not null and ${table.optInConfirmedAt} is not null)`,
    ),
  ],
);
