import type Anthropic from "@anthropic-ai/sdk";
import type { TurnActor } from "@/lib/agent/types";
import { updateClient, type UpdateClientError, type UpdateClientInput } from "@/lib/clients/update-client";

/**
 * `update_client` IS client-scoped (`CLIENT_SCOPED_TOOLS` in
 * risk-interceptor.ts, plan 05-02) — the interceptor already validates
 * `clientId` as a UUID and cross-checks a `client_contact` caller before
 * this file's `execute()` ever runs. Calls only the agent-facing
 * (tsx-safe, identity-based) `updateClient` from `lib/clients/update-client.ts`,
 * never its Clerk-session-derived web Server Action counterpart in
 * `update-client-action.ts`.
 */
export const catalogCode = "update_client";

export const definition: Anthropic.Messages.Tool = {
  name: "update_client",
  description:
    "Actualiza uno o más datos de un cliente existente. Solo cambia los campos que se indiquen explícitamente.",
  input_schema: {
    type: "object",
    properties: {
      clientId: { type: "string", description: "UUID del cliente" },
      name: { type: "string", description: "Nombre del cliente (opcional)" },
      phone: { type: "string", description: "Teléfono del cliente (opcional)" },
      email: { type: "string", description: "Correo del cliente (opcional)" },
      industry: {
        type: "string",
        description:
          "Rubro del cliente (opcional). Códigos válidos: restaurants_food, health_beauty, fashion_retail, professional_services, real_estate, fitness_sports, education, other",
      },
      notes: { type: "string", description: "Notas sobre el cliente (opcional)" },
    },
    required: ["clientId"],
  },
};

type UpdateClientToolInput = {
  clientId: string;
  name?: string;
  phone?: string;
  email?: string;
  industry?: string;
  notes?: string;
};

// Hand-written narrowing, no runtime schema-validation dependency — repo
// posture (see parse-webhook-payload.ts's own header comment).
function isValidInput(input: unknown): input is UpdateClientToolInput {
  if (typeof input !== "object" || input === null) return false;
  const record = input as Record<string, unknown>;
  if (typeof record.clientId !== "string") return false;
  const optionalStringOk = (value: unknown) => value === undefined || typeof value === "string";
  return (
    optionalStringOk(record.name) &&
    optionalStringOk(record.phone) &&
    optionalStringOk(record.email) &&
    optionalStringOk(record.industry) &&
    optionalStringOk(record.notes)
  );
}

function describeError(error: UpdateClientError): string {
  switch (error) {
    case "nameRequired":
      return "Falta el nombre del cliente.";
    case "contactRequired":
      return "Falta un dato de contacto: pide teléfono o correo antes de actualizar el cliente.";
    case "invalidIndustry":
      return "El rubro indicado no es válido.";
    case "notFound":
      return "No encontré ese cliente o no tenés acceso a él.";
    case "forbidden":
      return "No tenés permiso para actualizar clientes.";
    case "unknown":
    default:
      return "No se pudo actualizar el cliente por un error inesperado.";
  }
}

export async function execute(input: unknown, actor: TurnActor): Promise<string> {
  if (!isValidInput(input)) {
    return "Entrada inválida: se requiere al menos clientId.";
  }

  const patch: UpdateClientInput = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.email !== undefined) patch.email = input.email;
  if (input.industry !== undefined) patch.industry = input.industry;
  if (input.notes !== undefined) patch.notes = input.notes;

  if (Object.keys(patch).length === 0) {
    return "No especificaste qué cambiar del cliente.";
  }

  const result = await updateClient({
    agencyId: actor.agencyId,
    identity: actor.identity,
    clientId: input.clientId,
    input: patch,
  });

  if (!result.success) {
    return describeError(result.error);
  }

  return "Cliente actualizado.";
}
