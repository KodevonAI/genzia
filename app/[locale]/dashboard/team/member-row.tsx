import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { TeamMemberRow } from "@/lib/team/list-members";

const ROLE_BADGE_CLASS: Record<string, string> = {
  admin: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
  member: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  invited: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  active: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  removed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

export async function MemberRow({
  member,
  isAdmin,
}: {
  member: TeamMemberRow;
  isAdmin: boolean;
}) {
  const t = await getTranslations("Team");

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{member.email}</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {member.whatsappNumber ?? t("noWhatsapp")}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_BADGE_CLASS[member.role] ?? ROLE_BADGE_CLASS.member}`}
        >
          {t(`role.${member.role}`)}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[member.status] ?? STATUS_BADGE_CLASS.invited}`}
        >
          {t(`status.${member.status}`)}
        </span>
        {isAdmin ? (
          <Link
            href={`/dashboard/team/${member.id}`}
            className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            {t("manageClients")}
          </Link>
        ) : null}
      </div>
    </li>
  );
}
