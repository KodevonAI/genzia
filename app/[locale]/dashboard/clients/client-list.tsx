import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { ClientRow } from "@/lib/clients/list-clients";

/**
 * Plain async Server Component, same `<ul>` shape as `AuditList`
 * (bitacora/audit-list.tsx). No filtering happens here or in page.tsx —
 * `clients` is already exactly what the caller is allowed to see, per
 * `clients_select_by_role` RLS plus `listClients`'s own text filter
 * (T-05-16).
 */
export async function ClientList({ clients }: { clients: ClientRow[] }) {
  const t = await getTranslations("Clients");

  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {clients.map((client) => (
        <li key={client.id} className="flex items-center gap-3 py-3">
          <Link href={`/dashboard/clients/${client.id}`} className="flex items-center gap-3 text-sm hover:underline">
            <span>{client.name}</span>
          </Link>
          {client.industry ? (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {t(`industries.${client.industry}`)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
