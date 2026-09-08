import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getCurrentTeamMember } from "@/lib/team/current-member";
import { getTeamMemberById } from "@/lib/team/list-members";
import { listAssignedClientIds, listClients } from "@/lib/clients/list-clients";
import { AssignClientsForm } from "./assign-clients-form";

/**
 * Admin-only client-assignment page (CTA-06). Redirects non-admins away at
 * the page level as a UX convenience — the actual access-control boundary
 * is `assignClient`/`unassignClient` re-checking admin status server-side
 * on every call (see lib/team/current-member.ts), so this redirect is not
 * what makes the boundary real.
 */
export default async function ManageMemberClientsPage({
  params,
}: {
  params: Promise<{ locale: string; memberId: string }>;
}) {
  const { locale, memberId } = await params;
  const t = await getTranslations("Team");

  const currentMember = await getCurrentTeamMember();
  if (!currentMember || currentMember.role !== "admin") {
    redirect({ href: "/dashboard/team", locale });
  }

  const [targetMember, clients] = await Promise.all([
    getTeamMemberById(memberId),
    listClients(),
  ]);

  if (!targetMember) {
    // `redirect` is typed `never` and does throw at runtime (Next.js's
    // NEXT_REDIRECT signal) — the `return null` below is dead code at
    // runtime, needed only because next-intl's generic `redirect` type
    // doesn't narrow `targetMember` for TypeScript's control-flow analysis
    // the way a plain `(): never` function would.
    redirect({ href: "/dashboard/team", locale });
    return null;
  }

  const assignedIds = await listAssignedClientIds(memberId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("assignHeading", { email: targetMember.email })}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("assignSubtitle")}</p>
        {targetMember.role === "admin" ? (
          <p className="w-fit rounded-md bg-blue-50 px-3 py-1.5 text-xs text-blue-900 dark:bg-blue-950 dark:text-blue-200">
            {t("adminSeesAllNote")}
          </p>
        ) : null}
      </div>

      <AssignClientsForm
        teamMemberId={memberId}
        clients={clients}
        initialAssignedIds={assignedIds}
      />
    </div>
  );
}
