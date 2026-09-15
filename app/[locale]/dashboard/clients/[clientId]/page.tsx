import { Lock } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { getClient } from "@/lib/clients/get-client";
import { listAssignedTeamMemberIds } from "@/lib/clients/list-clients";
import { getCurrentTeamMember } from "@/lib/team/current-member";
import { listTeamMembers } from "@/lib/team/list-members";
import { AssignmentPanel } from "./assignment-panel";
import { ConversationHistory } from "./conversation-history";

/**
 * The client ficha (CLI-02 / CLI-05 / SEG-08 / D-15 / D-16), composed
 * exactly per 05-UI-SPEC.md's "Ficha Layout" section: header, contact info,
 * assignment, team-only notes, pagos/próximas-citas placeholders, and the
 * real conversation history — in that order. Every fetch below is a plain
 * call into an already-scoped read (`getClient`, `listAssignedTeamMemberIds`,
 * `listTeamMembers`) — no manual filter of our own (T-05-19): `getClient`
 * returning `null` (row doesn't exist OR isn't visible to this caller,
 * collapsed identically by `clients_select_by_role` RLS) redirects away
 * before any other data for this client is fetched, so no partial page ever
 * renders for an inaccessible client.
 */
export default async function ClientFichaPage({
  params,
}: {
  params: Promise<{ locale: string; clientId: string }>;
}) {
  const { locale, clientId } = await params;
  const t = await getTranslations("Clients");

  const [client, currentMember] = await Promise.all([
    getClient(clientId),
    getCurrentTeamMember(),
  ]);

  if (!client) {
    redirect({ href: "/dashboard/clients", locale });
    return null;
  }

  // Same mid-provisioning window bitacora/page.tsx and team/page.tsx handle:
  // signed in via Clerk, `team_members` row not landed yet.
  if (!currentMember) {
    const tTeam = await getTranslations("Team");
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {tTeam("provisioning")}
      </div>
    );
  }

  const [teamMembers, assignedIds] = await Promise.all([
    listTeamMembers(),
    listAssignedTeamMemberIds(clientId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{client.name}</h1>
          {client.industry ? (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {t(`industries.${client.industry}`)}
            </span>
          ) : null}
        </div>
        <Link
          href={`/dashboard/clients/${clientId}/edit`}
          className="shrink-0 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
        >
          {t("editLink")}
        </Link>
      </div>

      <div className="flex flex-wrap gap-6">
        {client.phone ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {t("phoneLabel")}
            </span>
            <span className="font-mono text-sm">{client.phone}</span>
          </div>
        ) : null}
        {client.email ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {t("emailLabel")}
            </span>
            <span className="text-sm">{client.email}</span>
          </div>
        ) : null}
      </div>

      <AssignmentPanel
        clientId={clientId}
        allMembers={teamMembers.map((member) => ({ id: member.id, email: member.email }))}
        initialAssignedIds={assignedIds}
        isAdmin={currentMember.role === "admin"}
      />

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="flex items-center gap-1.5">
          <Lock size={12} className="text-zinc-500 dark:text-zinc-400" />
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t("notesLabel")}
          </span>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("notesTeamOnlyCaption")}</p>
        {client.notes ? (
          <p className="mt-2 whitespace-pre-wrap text-sm">{client.notes}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-medium">{t("pagosHeading")}</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t("emptyPayments")}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-medium">{t("appointmentsHeading")}</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {t("emptyAppointments")}
          </p>
        </div>
      </div>

      <ConversationHistory clientId={clientId} />
    </div>
  );
}
