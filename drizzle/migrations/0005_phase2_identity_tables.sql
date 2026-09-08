CREATE TABLE "authorized_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone_number" text NOT NULL,
	"email" text,
	"contact_role" text,
	"opt_in_confirmed_by_team" boolean DEFAULT false NOT NULL,
	"opt_in_confirmed_by" uuid,
	"opt_in_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authorized_contacts_opt_in_consistency_check" CHECK (("authorized_contacts"."opt_in_confirmed_by_team" = false) or ("authorized_contacts"."opt_in_confirmed_by" is not null and "authorized_contacts"."opt_in_confirmed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "agent_action_catalog" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"risk_level" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_action_catalog_risk_level_check" CHECK ("agent_action_catalog"."risk_level" in ('low', 'high'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" text NOT NULL,
	"client_id" uuid,
	"action_type_code" text NOT NULL,
	"risk_level" text NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_risk_level_check" CHECK ("audit_log"."risk_level" in ('low', 'high'))
);
--> statement-breakpoint
ALTER TABLE "authorized_contacts" ADD CONSTRAINT "authorized_contacts_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorized_contacts" ADD CONSTRAINT "authorized_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorized_contacts" ADD CONSTRAINT "authorized_contacts_opt_in_confirmed_by_team_members_id_fk" FOREIGN KEY ("opt_in_confirmed_by") REFERENCES "public"."team_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_action_type_code_agent_action_catalog_code_fk" FOREIGN KEY ("action_type_code") REFERENCES "public"."agent_action_catalog"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "authorized_contacts_agency_id_phone_number_idx" ON "authorized_contacts" USING btree ("agency_id","phone_number");