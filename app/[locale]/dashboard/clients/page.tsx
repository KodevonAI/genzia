import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCurrentTeamMember } from "@/lib/team/current-member";
import { listClients } from "@/lib/clients/list-clients";
import { ClientSearch } from "./client-search";
import { ClientList } from "./client-list";

/**
 * CLI-04 (D-11's reinterpretation): the same RLS-scoped rows the member
 * already sees via `clients_select_by_role`, optionally narrowed by a free
 * text `?q=` search param through `listClients(q)`. No manual role/agency
 * filter is added anywhere in this file or in client-list.tsx (T-05-16) —
 * `listClients` is the only scope.
 */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const [t, resolvedSearchParams, currentMember] = await Promise.all([
    getTranslations("Clients"),
    searchParams,
    getCurrentTeamMember(),
  ]);

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

  const q = resolvedSearchParams.q?.trim() || undefined;
  const clients = await listClients(q);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("subtitle")}</p>
        </div>
        <Link
          href="/dashboard/clients/new"
          className="w-fit rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {t("newClient")}
        </Link>
      </div>

      <ClientSearch initialQuery={q ?? ""} />

      {clients.length === 0 && !q ? (
        <div className="flex flex-col gap-1 py-8 text-center">
          <p className="text-sm font-medium">{t("emptyNoClients.title")}</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("emptyNoClients.subtitle")}</p>
        </div>
      ) : clients.length === 0 && q ? (
        <div className="flex flex-col gap-1 py-8 text-center">
          <p className="text-sm font-medium">{t("emptyNoResults.title", { query: q })}</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("emptyNoResults.subtitle")}</p>
        </div>
      ) : (
        <ClientList clients={clients} />
      )}
    </div>
  );
}
