"use server";

import "server-only";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { teamMembers } from "@/lib/db/schema/team-members";
import { NoTenantContextError, withTenantContext } from "@/lib/tenant/with-tenant-context";
import { NotAdminError, assertCallerIsAdmin } from "@/lib/team/current-member";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Light E.164-ish check (leading "+", 8-15 digits total): full validation
// isn't critical here — Phase 3's Meta integration is where this number is
// actually validated against WhatsApp's API.
const WHATSAPP_RE = /^\+[1-9]\d{7,14}$/;

export type InviteMemberInput = {
  email: string;
  role: string;
  whatsappNumber: string;
};

export type InviteMemberResult =
  | { ok: true; teamMemberId: string }
  | {
      ok: false;
      error:
        | "not_admin"
        | "invalid_email"
        | "invalid_role"
        | "invalid_whatsapp"
        | "already_invited"
        | "clerk_error";
    };

function toClerkOrgRole(role: "admin" | "member"): "org:admin" | "org:member" {
  return role === "admin" ? "org:admin" : "org:member";
}

/**
 * Admin-only Server Action (CTA-04): creates a Clerk organization invitation
 * carrying `{ role, whatsappNumber }` as `publicMetadata` — the only place
 * those two fields are captured — then a corresponding `team_members` row
 * with `status: "invited"` so the roster shows the pending invite
 * immediately, before acceptance.
 *
 * Returns a structured `{ ok: false, error }` result rather than throwing
 * for every *expected* failure mode (bad input, already invited, not an
 * admin) — Next.js strips thrown Server Action error messages down to a
 * generic string in production, which would make it impossible for the
 * client to render a specific, translated error. `NoTenantContextError`
 * (no signed-in session / no active org at all) is the one exception: that
 * is not a recoverable form-validation state, so it's left to throw and be
 * handled the same way every other tenant-context failure in this app is.
 */
export async function inviteMember(input: InviteMemberInput): Promise<InviteMemberResult> {
  const email = input.email.trim().toLowerCase();
  const role = input.role;
  const whatsappNumber = input.whatsappNumber.trim();

  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "invalid_email" };
  }
  if (role !== "admin" && role !== "member") {
    return { ok: false, error: "invalid_role" };
  }
  if (!WHATSAPP_RE.test(whatsappNumber)) {
    return { ok: false, error: "invalid_whatsapp" };
  }

  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    throw new NoTenantContextError();
  }

  try {
    return await withTenantContext(async (tx) => {
      await assertCallerIsAdmin(tx, userId);

      // Checked before calling Clerk's API so a duplicate invite is
      // rejected without leaving an orphaned Clerk invitation behind (see
      // the race-condition note on the post-insert check below for the one
      // gap this pre-check doesn't close).
      const [existing] = await tx
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(eq(teamMembers.email, email));
      if (existing) {
        return { ok: false, error: "already_invited" } as const;
      }

      const client = await clerkClient();
      try {
        await client.organizations.createOrganizationInvitation({
          organizationId: orgId,
          emailAddress: email,
          role: toClerkOrgRole(role),
          publicMetadata: { role, whatsappNumber },
        });
      } catch (clerkError) {
        console.error("inviteMember: Clerk createOrganizationInvitation failed", clerkError);
        return { ok: false, error: "clerk_error" } as const;
      }

      // `ON CONFLICT DO NOTHING` on the unique (agency_id, email) index
      // (Plan 01) guards the narrow race between the pre-check above and
      // this insert (two concurrent invites for the same email). If it
      // fires, the Clerk invitation just created above is orphaned (no
      // matching team_members row) — logged, not silently discarded, and
      // rare enough (concurrent double-submit) not to warrant a
      // cross-system rollback in this phase.
      const [inserted] = await tx
        .insert(teamMembers)
        .values({ agencyId: orgId, email, role, whatsappNumber, status: "invited" })
        .onConflictDoNothing({ target: [teamMembers.agencyId, teamMembers.email] })
        .returning({ id: teamMembers.id });

      if (!inserted) {
        console.warn(
          `inviteMember: race on (agencyId=${orgId}, email=${email}) — Clerk invitation created but no team_members row inserted.`,
        );
        return { ok: false, error: "already_invited" } as const;
      }

      return { ok: true, teamMemberId: inserted.id } as const;
    });
  } catch (err) {
    if (err instanceof NotAdminError) {
      return { ok: false, error: "not_admin" };
    }
    throw err;
  }
}
