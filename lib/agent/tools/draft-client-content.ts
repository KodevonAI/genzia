import type Anthropic from "@anthropic-ai/sdk";
import type { TurnActor } from "@/lib/agent/types";
import { deliverToClient } from "./deliver-to-client";

/**
 * LD-06: `new_client_content`, risk `high` per `agent_action_catalog` (seeded
 * in migration 0008) — a new piece of client-facing content is exactly the
 * kind of action that needs a human to look at it before it goes out.
 *
 * `execute()` below is only ever reached through the approval-replay path
 * (plan 04-09), once a human has approved the queued proposal. The risk
 * interceptor never calls it inline for a high-risk classification — see
 * that file's high branch, which returns without touching this function at
 * all.
 */
export const catalogCode = "new_client_content";

export const definition: Anthropic.Messages.Tool = {
  name: "draft_client_content",
  description:
    "Envía contenido nuevo (propuesta, material, borrador) a un cliente por WhatsApp. Requiere aprobación del equipo antes de ejecutarse.",
  input_schema: {
    type: "object",
    properties: {
      clientId: { type: "string", description: "UUID del cliente" },
      contentDraft: {
        type: "string",
        description: "Contenido a enviar al cliente",
      },
    },
    required: ["clientId", "contentDraft"],
  },
};

type DraftClientContentInput = { clientId: string; contentDraft: string };

// Hand-written narrowing, no runtime schema-validation dependency — repo
// posture (see parse-webhook-payload.ts's own header comment).
function isValidInput(input: unknown): input is DraftClientContentInput {
  if (typeof input !== "object" || input === null) return false;
  const record = input as Record<string, unknown>;
  return (
    typeof record.clientId === "string" &&
    typeof record.contentDraft === "string"
  );
}

export async function execute(
  input: unknown,
  actor: TurnActor,
): Promise<string> {
  if (!isValidInput(input)) {
    return "Entrada inválida: se requieren clientId y contentDraft.";
  }

  const result = await deliverToClient({
    agencyId: actor.agencyId,
    clientId: input.clientId,
    identity: actor.identity,
    body: input.contentDraft,
  });

  if (result.delivered) {
    return `Contenido enviado al cliente ${input.clientId} (WhatsApp ${result.metaMessageId}).`;
  }

  return `No se pudo enviar el contenido: ${result.reason}`;
}
