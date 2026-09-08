import { getTranslations } from "next-intl/server";
import { getCurrentTeamMember } from "@/lib/team/current-member";
import { listTeamMembers } from "@/lib/team/list-members";
import { InviteForm } from "./invite-form";
import { MemberRow } from "./member-row";

/**
 * Team roster (CTA-04/CTA-05). Visible to any team member — only the invite
 * form and each row's "assign clients" link are gated to admins, matching
 * `listTeamMembers`'s own not-admin-only read policy.
 */
export default async function TeamPage() {
  const t = await getTranslations("Team");

  const [currentMember, members] = await Promise.all([
    getCurrentTeamMember(),
    listTeamMembers(),
  ]);

  // Mid-provisioning window (signed in via Clerk, team_members row not
  // landed yet — see lib/team/sync-membership.ts) rather than an error
  // state: the row will exist within moments of the webhook firing.
  if (!currentMember) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {t("provisioning")}
      </div>
    );
  }

  const isAdmin = currentMember.role === "admin";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("subtitle")}</p>
      </div>

      {isAdmin ? <InviteForm /> : null}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {t("rosterHeading")}
        </h2>
        {members.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {members.map((member) => (
              <MemberRow key={member.id} member={member} isAdmin={isAdmin} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
