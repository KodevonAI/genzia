import type Anthropic from "@anthropic-ai/sdk";
import { ilike, or } from "drizzle-orm";
import type { TurnActor } from "@/lib/agent/types";
import { clients } from "@/lib/db/schema/clients";
import { withResolvedIdentityContext } from "@/lib/tenant/with-resolved-identity-context";

/**
 * D-11: `list_clients` is agency-scoped, so it is deliberately excluded from
 * `CLIENT_SCOPED_TOOLS` in `risk-interceptor.ts` (plan 05-02) — no
 * `clientId` field on this tool at all (see 05-RESEARCH.md's Anti-Patterns
 * note: do not fake one just to satisfy the interceptor).
 *
 * This tool opens its OWN `withResolvedIdentityContext` scope and runs its
 * own inline query directly against the `clients` schema — it deliberately
 * does not import the web-only read helper in
 * `lib/clients/list-clients.ts`, which carries a throwing-under-tsx import
 * guard and would crash this module under `tsx`/Inngest (see 05-03-PLAN.md's
 * `<interfaces>` section for why). `clients_select_by_role` RLS (unchanged
 * this phase) is the only scope filter applied — no manual agency/role
 * predicate is added here (T-05-12).
 */
export const catalogCode = "list_clients";

export const definition: Anthropic.Messages.Tool = {
  name: "list_clients",
  description:
    "Busca clientes por nombre, rubro o notas. Devuelve solo lo que el que pregunta ya puede ver, incluyendo el id de cada cliente — usalo para llamar a get_client o update_client sobre uno de los resultados. Sin texto de búsqueda, lista todos los visibles (hasta 20).",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Texto a buscar en nombre, rubro o notas. Opcional.",
      },
    },
    required: [],
  },
};

type ListClientsToolInput = { query?: string };

// Hand-written narrowing, no runtime schema-validation dependency — repo
// posture (see parse-webhook-payload.ts's own header comment).
function isValidInput(input: unknown): input is ListClientsToolInput {
  if (typeof input !== "object" || input === null) return false;
  const record = input as Record<string, unknown>;
  return record.query === undefined || typeof record.query === "string";
}

export async function execute(input: unknown, actor: TurnActor): Promise<string> {
  if (!isValidInput(input)) {
    return "Entrada inválida: query debe ser texto.";
  }

  const trimmed = input.query?.trim();

  const rows = await withResolvedIdentityContext(actor.agencyId, actor.identity, (tx) => {
    const base = tx
      .select({
        id: clients.id,
        name: clients.name,
        phone: clients.phone,
        email: clients.email,
        industry: clients.industry,
      })
      .from(clients);

    const query = trimmed
      ? base.where(
          or(
            ilike(clients.name, `%${trimmed}%`),
            ilike(clients.industry, `%${trimmed}%`),
            ilike(clients.notes, `%${trimmed}%`),
          ),
        )
      : base;

    return query.orderBy(clients.name).limit(20);
  });

  if (rows.length === 0) {
    return "No se encontraron clientes.";
  }

  return rows
    .map((row) => {
      const industryLabel = row.industry ?? "sin industria";
      const contactLabel = row.phone ?? row.email ?? "sin contacto";
      return `${row.name} (${industryLabel}) — ${contactLabel} [id: ${row.id}]`;
    })
    .join("\n");
}
