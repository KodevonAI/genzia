-- Phase 5 (CRM): extends `clients` with the real intake fields (D-01/D-02/
-- D-03/D-04) — this repo never uses pgEnum (see team-members.ts's
-- role/status check-constraint convention), so `industry` is a plain `text`
-- column gated by a CHECK against the 8-code list in
-- `lib/clients/industries.ts`, not a Postgres enum type.
--
-- D-02: a client must have a name plus at least one of phone/email. Enforced
-- here at the DB layer as defense-in-depth (app-layer validation is the
-- primary UX gate) via `clients_contact_required_check`.
--
-- KNOWN RISK: `clients_contact_required_check` will fail to apply if any
-- existing `clients` row in the real database already has BOTH `phone` and
-- `email` null — exactly what the old `addClient(name)` quick-add flow
-- (Pitfall 3, removed later in this phase's plan 09) produces. This
-- migration does not backfill anything; if applying it against real Neon
-- fails on this constraint, plan 05-10 (the blocking migration-apply plan)
-- is where that gets diagnosed and fixed for real (Rule 1) — most likely a
-- one-time `UPDATE clients SET phone = '(sin dato)' WHERE phone IS NULL AND
-- email IS NULL` before retrying, never a loosened constraint.

ALTER TABLE clients
  ADD COLUMN phone text,
  ADD COLUMN email text,
  ADD COLUMN industry text,
  ADD COLUMN notes text;
--> statement-breakpoint

ALTER TABLE clients
  ADD CONSTRAINT clients_industry_check
  CHECK (
    industry is null or industry in (
      'restaurants_food', 'health_beauty', 'fashion_retail',
      'professional_services', 'real_estate', 'fitness_sports',
      'education', 'other'
    )
  );
--> statement-breakpoint

ALTER TABLE clients
  ADD CONSTRAINT clients_contact_required_check
  CHECK (phone is not null or email is not null);
