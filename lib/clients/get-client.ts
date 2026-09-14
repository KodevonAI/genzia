import "server-only";
import { eq } from "drizzle-orm";
import { clients } from "@/lib/db/schema/clients";
import { withTenantContext } from "@/lib/tenant/with-tenant-context";
import type { ClientRow } from "./list-clients";

/**
 * Web-only single-row read — never imported by an agent tool (the agent
 * tool's own `get_client` does its own inline query instead, see plan
 * 05-04). No extra predicate beyond `eq(clients.id, clientId)` —
 * `clients_select_by_role` RLS is the only scope, same posture as
 * `list-clients.ts`.
 */
export async function getClient(clientId: string): Promise<ClientRow | null> {
  const [row] = await withTenantContext((tx) =>
    tx.select().from(clients).where(eq(clients.id, clientId)),
  );
  return row ?? null;
}
