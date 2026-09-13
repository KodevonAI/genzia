/**
 * D-01's outbound proof, kept as a file for its own real history. Phase 4's
 * `process-agent-turn.ts` superseded this function: the event contract, the
 * retry shape and the persistence path this header used to describe all
 * live on there now, extended rather than rebuilt, exactly as this comment
 * originally said they would be.
 *
 * The function registration call that used to live here is removed on
 * purpose — exactly one function may be triggered by the inbound WhatsApp
 * event (`process-agent-turn.ts`); leaving both registered would
 * double-reply to a real person's phone. Nothing here is wired into
 * `app/api/inngest/route.ts` anymore.
 *
 * Deviation note preserved from Phase 3 for anyone reading this file's
 * history: the Inngest v4 function-registration helper takes exactly two
 * arguments — an options object (trigger merged in as
 * `triggers: [{ event }]`) and the handler — not the three-argument
 * `(options, trigger, handler)` v3-era shape an earlier plan's sample used.
 */

/** @deprecated Superseded by `process-agent-turn.ts` in Phase 4. Kept only
 * so this file's own history (D-01) still reads correctly; not used by any
 * live code path. */
export const ACK_TEXT = "Mensaje recibido";
