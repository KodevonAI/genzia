import { getClient } from "@/lib/clients/get-client";
import { redirect } from "@/i18n/navigation";
import { ClientForm } from "../../client-form";

/**
 * CLI-03's edit surface. `getClient` returns `null` identically for "does
 * not exist" and "not visible to this caller's RLS scope" (T-05-17) — this
 * page redirects on `null` with no distinguishing message, never rendering
 * a broken/blank form.
 */
export default async function EditClientPage({
  params,
}: {
  params: Promise<{ locale: string; clientId: string }>;
}) {
  const { locale, clientId } = await params;
  const client = await getClient(clientId);

  if (!client) {
    redirect({ href: "/dashboard/clients", locale });
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{client.name}</h1>
      <ClientForm mode="edit"
        clientId={client.id}
        initialValues={{
          name: client.name,
          phone: client.phone,
          email: client.email,
          industry: client.industry,
          notes: client.notes,
        }}
      />
    </div>
  );
}
