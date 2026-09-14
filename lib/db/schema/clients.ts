import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agencies } from "./agencies";

/**
 * Phase 5 (CRM) — this migration IS the one this file's old stub comment
 * named. Real CRM fields: phone/email/industry/notes, plus two check
 * constraints (D-01/D-02/D-03/D-04). See migration 0020
 * (`drizzle/migrations/0020_clients_crm_fields.sql`) for the matching DDL,
 * and `lib/clients/industries.ts` for the industry code list this table's
 * `clients_industry_check` mirrors.
 */
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: text("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    industry: text("industry"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "clients_industry_check",
      sql`${table.industry} is null or ${table.industry} in ('restaurants_food','health_beauty','fashion_retail','professional_services','real_estate','fitness_sports','education','other')`,
    ),
    // D-02: name + at least one of phone/email, enforced at the DB layer too
    // (defense in depth — app-layer validation is the primary UX gate).
    check(
      "clients_contact_required_check",
      sql`${table.phone} is not null or ${table.email} is not null`,
    ),
  ],
);
