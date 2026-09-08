/**
 * The three identity shapes Genzia resolves an incoming message to, per
 * SEG-01 and PROJECT.md §"Modelo de identidad y permisos". This is the single
 * source of truth for the identity contract — `lib/tenant/with-resolved-
 * identity-context.ts` branches on `type` to decide which Postgres GUCs to
 * set, and every RLS policy keyed on those GUCs is the actual enforcement.
 *
 * Naming note (RESEARCH.md Pitfall 3): the opt-in flag is
 * `optInConfirmedByTeam`, never a bare `optInConfirmed` — it records the
 * agency team's own manual attestation (D-03's checkbox), NOT a
 * Meta-verified WhatsApp opt-in round-trip. Phase 3+ must not mistake one
 * for the other.
 */
export type ResolvedIdentity =
  | { type: "team_member"; teamMemberId: string; role: "admin" | "member" }
  | {
      type: "client_contact";
      contactId: string;
      clientId: string;
      optInConfirmedByTeam: boolean;
    }
  | { type: "unknown" };

/** Row shape `resolveIdentity` fetches from `team_members` before classifying. */
export type TeamMemberIdentityRow = { id: string; role: string };

/** Row shape `resolveIdentity` fetches from `authorized_contacts` before classifying. */
export type AuthorizedContactIdentityRow = {
  id: string;
  clientId: string;
  optInConfirmedByTeam: boolean;
};
