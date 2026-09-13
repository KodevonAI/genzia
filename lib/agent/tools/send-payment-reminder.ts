import type Anthropic from "@anthropic-ai/sdk";
import type { TurnActor } from "@/lib/agent/types";
import { deliverToClient } from "./deliver-to-client";

/**
 * LD-06: `payment_reminder`, risk `low` per `agent_action_catalog` (seeded in
 * migration 0008). The risk interceptor (this plan's other file) is the only
 * thing that decides whether `execute()` below ever runs — this file has no
 * opinion on its own risk level and must never be asked to classify itself.
 */
export const catalogCode = "payment_reminder";

export const definition: Anthropic.Messages.Tool = {
  name: "send_payment_reminder",
  description:
    "Envía un recordatorio de pago a un cliente por WhatsApp, en el tono de la marca de la agencia.",
  input_schema: {
    type: "object",
    properties: {
      clientId: { type: "string", description: "UUID del cliente" },
      message: {
        type: "string",
        description: "Texto del recordatorio, en el tono de la marca",
      },
    },
    required: ["clientId", "message"],
  },
};

type SendPaymentReminderInput = { clientId: string; message: string };

// Hand-written narrowing, no runtime schema-validation dependency — repo
// posture (see parse-webhook-payload.ts's own header comment).
function isValidInput(input: unknown): input is SendPaymentReminderInput {
  if (typeof input !== "object" || input === null) return false;
  const record = input as Record<string, unknown>;
  return (
    typeof record.clientId === "string" && typeof record.message === "string"
  );
}

export async function execute(
  input: unknown,
  actor: TurnActor,
): Promise<string> {
  if (!isValidInput(input)) {
    return "Entrada inválida: se requieren clientId y message.";
  }

  const result = await deliverToClient({
    agencyId: actor.agencyId,
    clientId: input.clientId,
    identity: actor.identity,
    body: input.message,
  });

  if (result.delivered) {
    return `Recordatorio de pago enviado al cliente ${input.clientId} (WhatsApp ${result.metaMessageId}).`;
  }

  return `No se pudo enviar el recordatorio: ${result.reason}`;
}
