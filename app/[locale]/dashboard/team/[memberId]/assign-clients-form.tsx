"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { assignClient, unassignClient } from "@/lib/clients/assign-client";
import type { ClientRow } from "@/lib/clients/list-clients";

/**
 * Admin-only (CTA-06). Optimistic toggle per client: flips local state
 * immediately, calls the corresponding Server Action, and rolls back on
 * `{ ok: false }` — `assignClient`/`unassignClient` re-check admin status
 * server-side regardless (this page already redirects non-admins away, but
 * that's a UX convenience, not the access-control boundary — see
 * lib/team/current-member.ts).
 */
export function AssignClientsForm({
  teamMemberId,
  clients,
  initialAssignedIds,
}: {
  teamMemberId: string;
  clients: ClientRow[];
  initialAssignedIds: string[];
}) {
  const t = useTranslations("Team");
  const tClients = useTranslations("Clients");
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set(initialAssignedIds));
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function toggle(clientId: string) {
    const wasAssigned = assignedIds.has(clientId);
    setError(null);
    setPendingIds((current) => new Set(current).add(clientId));
    setAssignedIds((current) => {
      const next = new Set(current);
      if (wasAssigned) {
        next.delete(clientId);
      } else {
        next.add(clientId);
      }
      return next;
    });

    const result = wasAssigned
      ? await unassignClient(clientId, teamMemberId)
      : await assignClient(clientId, teamMemberId);

    setPendingIds((current) => {
      const next = new Set(current);
      next.delete(clientId);
      return next;
    });

    if (!result.ok) {
      // Roll back to the pre-toggle state.
      setAssignedIds((current) => {
        const next = new Set(current);
        if (wasAssigned) {
          next.add(clientId);
        } else {
          next.delete(clientId);
        }
        return next;
      });
      setError(t("errors.notAdmin"));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-end">
        <Link
          href="/dashboard/clients/new"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
        >
          {tClients("newClient")}
        </Link>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {clients.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("noClients")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {clients.map((client) => {
            const isAssigned = assignedIds.has(client.id);
            const isPending = pendingIds.has(client.id);
            return (
              <li key={client.id} className="flex items-center justify-between gap-3 py-3">
                <span className="text-sm">{client.name}</span>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isAssigned}
                    disabled={isPending}
                    onChange={() => toggle(client.id)}
                    className="size-4"
                  />
                  {isAssigned ? t("assigned") : t("unassigned")}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
