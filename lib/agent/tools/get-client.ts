import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import type { TurnActor } from "@/lib/agent/types";
import { clients } from "@/lib/db/schema/clients";
import { withResolvedIdentityContext } from "@/lib/tenant/with-resolved-identity-context";

/**
 * `get_client` IS client-scoped (`CLIENT_SCOPED_TOOLS` in
 * risk-interceptor.ts, plan 05-02) — the interceptor already validates
 * `clientId` as a UUID and cross-checks a `client_contact` caller before
 * this file's `execute()` ever runs.
 *
 * This tool opens its OWN `withResolvedIdentityContext` scope and runs its
 * own inline query directly against the `clients` schema — it deliberately
 * does not import the web-only `lib/clients/get-client.ts` (throwing-under-
 * tsx import guard, would crash this module under `tsx`/Inngest — see
 * 05-03-PLAN.md's `<interfaces>` section). Notes ARE included in the
 * response: T-05-13's disposition is that `toolsFor()` never offers any
 * tool, including this one, to a `client_contact`/`unknown` identity in the
 * first place — this tool is team-member-only by construction upstream.
 */
export const catalogCode = "get_client";

export const definition: Anthropic.Messages.Tool = {
  name: "get_client",
  description: "Devuelve la ficha completa de un cliente: nombre, teléfono, correo, rubro y notas.",
  input_schema: {
    type: "object",
    properties: {
      clientId: { type: "string", description: "UUID del cliente" },
    },
    required: ["clientId"],
  },
};

type GetClientToolInput = { clientId: string };

// Hand-written narrowing, no runtime schema-validation dependency — repo
// posture (see parse-webhook-payload.ts's own header comment).
function isValidInput(input: unknown): input is GetClientToolInput {
  if (typeof input !== "object" || input === null) return false;
  const record = input as Record<string, unknown>;
  return typeof record.clientId === "string";
}

export async function execute(input: unknown, actor: TurnActor): Promise<string> {
  if (!isValidInput(input)) {
    return "Entrada inválida: se requiere clientId.";
  }

  const rows = await withResolvedIdentityContext(actor.agencyId, actor.identity, (tx) =>
    tx.select().from(clients).where(eq(clients.id, input.clientId)).limit(1),
  );

  const client = rows[0];
  if (!client) {
    return "No encontré ese cliente o no tenés acceso a él.";
  }

  const lines = [
    `Nombre: ${client.name}`,
    `Teléfono: ${client.phone ?? "sin dato"}`,
    `Correo: ${client.email ?? "sin dato"}`,
    `Rubro: ${client.industry ?? "sin dato"}`,
    `Notas: ${client.notes ?? "sin notas"}`,
  ];

  return lines.join("\n");
}
