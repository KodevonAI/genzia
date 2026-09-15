import type Anthropic from "@anthropic-ai/sdk";
import type { TurnActor } from "@/lib/agent/types";
import { createClient, type CreateClientError, type CreateClientInput } from "@/lib/clients/create-client";

/**
 * D-11: `create_client` is agency-scoped (there is no client yet to name),
 * so it is deliberately excluded from `CLIENT_SCOPED_TOOLS` in
 * `risk-interceptor.ts` (plan 05-02) — no `clientId` field on this tool at
 * all. Calls only the agent-facing (tsx-safe, identity-based) `createClient`
 * from `lib/clients/create-client.ts`, never its Clerk-session-derived web
 * Server Action counterpart in `create-client-action.ts`.
 */
export const catalogCode = "create_client";

export const definition: Anthropic.Messages.Tool = {
  name: "create_client",
  description:
    "Da de alta un nuevo cliente. Requiere name y al menos uno de phone o email; si falta ambos, pedí el dato antes de llamar a esta herramienta.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Nombre del cliente" },
      phone: { type: "string", description: "Teléfono del cliente (opcional)" },
      email: { type: "string", description: "Correo del cliente (opcional)" },
      industry: {
        type: "string",
        description:
          "Rubro del cliente (opcional). Códigos válidos: restaurants_food, health_beauty, fashion_retail, professional_services, real_estate, fitness_sports, education, other",
      },
      notes: { type: "string", description: "Notas sobre el cliente (opcional)" },
    },
    required: ["name"],
  },
};

type CreateClientToolInput = {
  name: string;
  phone?: string;
  email?: string;
  industry?: string;
  notes?: string;
};

// Hand-written narrowing, no runtime schema-validation dependency — repo
// posture (see parse-webhook-payload.ts's own header comment).
function isValidInput(input: unknown): input is CreateClientToolInput {
  if (typeof input !== "object" || input === null) return false;
  const record = input as Record<string, unknown>;
  if (typeof record.name !== "string") return false;
  const optionalStringOk = (value: unknown) => value === undefined || typeof value === "string";
  return (
    optionalStringOk(record.phone) &&
    optionalStringOk(record.email) &&
    optionalStringOk(record.industry) &&
    optionalStringOk(record.notes)
  );
}

function describeError(error: CreateClientError): string {
  switch (error) {
    case "nameRequired":
      return "Falta el nombre del cliente.";
    case "contactRequired":
      return "Falta un dato de contacto: pide teléfono o correo antes de crear el cliente.";
    case "invalidIndustry":
      return "El rubro indicado no es válido.";
    case "forbidden":
      return "No tenés permiso para crear clientes.";
    case "unknown":
    default:
      return "No se pudo crear el cliente por un error inesperado.";
  }
}

export async function execute(input: unknown, actor: TurnActor): Promise<string> {
  if (!isValidInput(input)) {
    return "Entrada inválida: se requiere al menos name.";
  }

  if (!input.phone && !input.email) {
    return "Falta un dato de contacto: pide teléfono o correo antes de crear el cliente.";
  }

  const clientInput: CreateClientInput = {
    name: input.name,
    phone: input.phone,
    email: input.email,
    industry: input.industry,
    notes: input.notes,
  };

  const result = await createClient({
    agencyId: actor.agencyId,
    identity: actor.identity,
    input: clientInput,
  });

  if (!result.success) {
    return describeError(result.error);
  }

  const base = `Cliente ${input.name} creado.`;
  return result.duplicateWarning ? `${base} ${result.duplicateWarning}` : base;
}
