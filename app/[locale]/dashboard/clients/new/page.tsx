import { getTranslations } from "next-intl/server";
import { getCurrentTeamMember } from "@/lib/team/current-member";
import { ClientForm } from "../client-form";

/**
 * CLI-01's "por formulario" half. Any team member (not just admin) can
 * reach this route and submit — `clients_insert_by_team_member` RLS (plan
 * 05-01) is the real boundary, this page only handles the mid-provisioning
 * window (same pattern as bitacora/page.tsx, team/page.tsx, clients/page.tsx).
 */
export default async function NewClientPage() {
  const currentMember = await getCurrentTeamMember();

  if (!currentMember) {
    const tTeam = await getTranslations("Team");
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {tTeam("provisioning")}
      </div>
    );
  }

  const t = await getTranslations("Clients");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("newClient")}</h1>
      <ClientForm mode="create" />
    </div>
  );
}
