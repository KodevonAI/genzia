CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" text NOT NULL,
	"client_id" uuid,
	"direction" text NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"from_phone_number" text NOT NULL,
	"to_phone_number" text NOT NULL,
	"meta_message_id" text,
	"resolved_identity_type" text NOT NULL,
	"resolved_identity_id" uuid,
	"message_type" text NOT NULL,
	"text_body" text,
	"media_id" text,
	"media_mime_type" text,
	"delivery_status" text,
	"conversation_id" text,
	"pricing_category" text,
	"pricing_billable" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_direction_check" CHECK ("messages"."direction" in ('inbound', 'outbound')),
	CONSTRAINT "messages_resolved_identity_type_check" CHECK ("messages"."resolved_identity_type" in ('team_member', 'client_contact', 'unknown')),
	CONSTRAINT "messages_message_type_check" CHECK ("messages"."message_type" in ('text', 'image', 'audio', 'unsupported'))
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_agency_id_meta_message_id_idx" ON "messages" USING btree ("agency_id","meta_message_id") WHERE "messages"."meta_message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_whatsapp_number_global_idx" ON "team_members" USING btree ("whatsapp_number") WHERE "team_members"."whatsapp_number" is not null;