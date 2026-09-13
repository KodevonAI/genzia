import { AI_DISCLOSURE_RULE } from "@/lib/identity/disclosure";
import type { ResolvedIdentity } from "@/lib/identity/types";

/**
 * Builds the per-turn system prompt (lib/agent/run-turn.ts, plan 04-12).
 *
 * SEG-09 is unconditional: `AI_DISCLOSURE_RULE` is spliced verbatim as its
 * own paragraph, before any identity-scope branching, so no early-return or
 * added branch can ever skip it. `scripts/verify-agent-prompt.ts` exists to
 * fail the build if anyone tries to add one that does. Do not paraphrase the
 * rule, do not wrap it in a template literal that could reflow its wording,
 * and do not add a per-agency override or disable flag — see
 * lib/identity/disclosure.ts's own header comment.
 *
 * The scope paragraph (step 3) is the ONLY place an identity's data access
 * is described in natural language to the model. It must never over-grant:
 * the client_contact branch in particular must never mention other clients,
 * agency-wide data, internal notes, profitability, or internal risk
 * (SEG-07/SEG-08) — `scripts/verify-agent-prompt.ts` asserts the literal
 * substring "todos los clientes" never appears in that branch's output.
 */
export type AgentBrand = { agentName: string | null; tone: string | null };

export function buildSystemPrompt(
  identity: ResolvedIdentity,
  brand: AgentBrand,
): string {
  const sections: string[] = [];

  // 1. Identity/brand line. Never interpolate a raw null — agentName and
  // tone are both nullable in agent_brand_config (white-label is optional).
  const brandName = brand.agentName ?? "el asistente";
  let identityLine =
    `Eres ${brandName}, el agente conversacional de la agencia. ` +
    "Ayudas al equipo de la agencia y a sus clientes por WhatsApp y chat web.";
  if (brand.tone) {
    identityLine += ` Tu tono es ${brand.tone}.`;
  }
  sections.push(identityLine);

  // 2. AI_DISCLOSURE_RULE, spliced verbatim, unconditional, before any
  // scope branching below.
  sections.push(AI_DISCLOSURE_RULE);

  // 3. Scope paragraph, branched on identity. This is where over-granting
  // would happen if it ever will — keep each branch narrow and explicit.
  if (identity.type === "team_member" && identity.role === "admin") {
    sections.push(
      "Tienes acceso a los datos de todos los clientes de la agencia.",
    );
  } else if (identity.type === "team_member" && identity.role === "member") {
    sections.push(
      "Solo tienes acceso a los clientes que te fueron asignados. Si te " +
        "preguntan por un cliente que no ves, dilo en vez de inventar.",
    );
  } else if (identity.type === "client_contact") {
    sections.push(
      "Estás hablando con un contacto autorizado de UN cliente. Solo " +
        "tienes acceso a los datos de ese cliente. Nunca menciones a otros " +
        "clientes de la agencia, ni notas internas, ni rentabilidad, ni " +
        "riesgos internos.",
    );
  } else {
    // identity.type === "unknown" — SEG-12.
    sections.push(
      "No reconoces este número. No tienes acceso a ningún dato de cuenta. " +
        "Responde de forma útil y orientada a convertir a la persona en " +
        "cliente o prospecto, sin afirmar ni negar la existencia de ninguna " +
        "cuenta.",
    );
  }

  // 4. Fixed operating paragraph.
  sections.push(
    "Nunca afirmas haber realizado una acción que no realizaste. Cuando una " +
      "acción necesita aprobación del equipo, lo dices claramente y no " +
      "prometes un plazo.",
  );

  return sections.join("\n\n");
}
