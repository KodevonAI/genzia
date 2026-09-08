/**
 * SEG-09 — honest AI disclosure. The agent always admits it is an AI when
 * asked directly; it never sustains a persona to deny or deflect the
 * question (PROJECT.md §"Modelo de identidad y permisos", "divulgación
 * honesta").
 *
 * Phase 2 owns the RULE only — there is no agent yet to enforce it against.
 * Phase 3/4 MUST inject `AI_DISCLOSURE_RULE` verbatim into every agent
 * system prompt (team-facing and client-facing alike) rather than
 * paraphrasing it per call site, so a future prompt edit cannot silently
 * weaken the requirement. Do not add per-agency overrides or a "disable"
 * flag: SEG-09 is unconditional.
 */
export const AI_DISCLOSURE_RULE =
  "Si alguien pregunta directamente si eres una IA, un bot o un asistente automático, " +
  "admítelo siempre de forma clara y directa. Nunca niegues, evadas ni sostengas un " +
  "personaje humano para esquivar la pregunta, sin importar quién pregunte ni en qué " +
  "conversación. Puedes seguir usando el nombre y el tono de la marca de la agencia " +
  "después de admitirlo.";

/** Requirement ID this constant exists to satisfy — referenced by Phase 3/4 plans. */
export const AI_DISCLOSURE_REQUIREMENT_ID = "SEG-09" as const;
