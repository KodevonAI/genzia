import type {
  AuthorizedContactIdentityRow,
  ResolvedIdentity,
  TeamMemberIdentityRow,
} from "./types";

/**
 * The pure decision core of identity resolution (D-07: "función pura
 * testeable"). Zero I/O, fully synchronous, no imports from the ORM layer,
 * the database module, or the tenant-context module — deliberately, so
 * `scripts/verify-identity-classification.ts` can prove every branch with no
 * database and no network. The network-dependent half (fetching these two
 * rows) lives in `lib/identity/resolve-identity.ts`.
 *
 * Precedence: a `team_members` match wins over an `authorized_contacts`
 * match. In practice both can never match the same number — the
 * cross-table trigger from migration 0006 rejects the second insert
 * (RESEARCH.md Pitfall 1) — but this function must still be total and
 * deterministic if that guard is ever bypassed by a direct DB edit.
 *
 * Trust boundary note (accepted v1 risk, RESEARCH.md Security Domain): the
 * phone number reaching the caller is whatever Meta's Tech-Provider-attested
 * sender number says it is. Genzia performs no independent proof of phone
 * ownership in v1; SIM reassignment / sender spoofing at the carrier level
 * is out of scope and is NOT an oversight in this function.
 */
export function classifyIdentity(
  teamMemberRow: TeamMemberIdentityRow | null,
  contactRow: AuthorizedContactIdentityRow | null,
): ResolvedIdentity {
  if (teamMemberRow) {
    return {
      type: "team_member",
      teamMemberId: teamMemberRow.id,
      role: teamMemberRow.role as "admin" | "member",
    };
  }

  if (contactRow) {
    return {
      type: "client_contact",
      contactId: contactRow.id,
      clientId: contactRow.clientId,
      optInConfirmedByTeam: contactRow.optInConfirmedByTeam,
    };
  }

  return { type: "unknown" };
}
