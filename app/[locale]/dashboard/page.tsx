import { getTranslations } from "next-intl/server";
import { agencies } from "@/lib/db/schema/agencies";
import { daysUntilTrialEnd } from "@/lib/agencies/trial";
import { withTenantContext } from "@/lib/tenant/with-tenant-context";
import { listClients } from "@/lib/clients/list-clients";
import { SettingUpAccount } from "./setting-up-account";

export default async function DashboardPage() {
  const t = await getTranslations("Dashboard");

  // RLS (agencies_tenant_isolation) already restricts this to at most the
  // caller's own agency row — no explicit WHERE needed, and no other
  // agency's row could ever come back here even if one were added.
  const agency = await withTenantContext(async (tx) => {
    const [row] = await tx.select().from(agencies).limit(1);
    return row ?? null;
  });

  // Webhook lag: the Clerk organization exists (the user is signed in with
  // an orgId, or withTenantContext would have thrown) but
  // organization.created hasn't landed in Postgres yet.
  if (!agency) {
    return <SettingUpAccount />;
  }

  const daysLeft = daysUntilTrialEnd(agency.trialEndsAt);

  // CTA-06's own proof surface: this list is exactly what
  // clients_select_by_role (Plan 01 RLS) returns for the signed-in caller —
  // every client for an admin, only assigned ones for a member — with no
  // manual filtering in this component. See lib/clients/list-clients.ts.
  const clients = await listClients();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">
          {t("welcome", { name: agency.name })}
        </h1>
        {daysLeft !== null ? (
          <p className="w-fit rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {t("trialBanner", { days: daysLeft })}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {t("clientsHeading")}
        </h2>
        {clients.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("noClients")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {clients.map((client) => (
              <li key={client.id} className="py-2 text-sm">
                {client.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
