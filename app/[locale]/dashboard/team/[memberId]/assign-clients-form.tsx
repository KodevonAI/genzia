"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { assignClient, unassignClient, addClient } from "@/lib/clients/assign-client";
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
  const router = useRouter();
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set(initialAssignedIds));
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [newClientName, setNewClientName] = useState("");
  const [isAddingClient, setIsAddingClient] = useState(false);
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

  async function handleAddClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = newClientName.trim();
    if (!trimmed) {
      return;
    }
    setIsAddingClient(true);
    setError(null);

    const result = await addClient(trimmed);
    if (!result.ok) {
      setError(result.error === "not_admin" ? t("errors.notAdmin") : t("errors.invalidClientName"));
      setIsAddingClient(false);
      return;
    }
    setNewClientName("");
    setIsAddingClient(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleAddClient} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
          <label htmlFor="new-client-name" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t("addClientLabel")}
          </label>
          <input
            id="new-client-name"
            type="text"
            value={newClientName}
            onChange={(event) => setNewClientName(event.target.value)}
            disabled={isAddingClient}
            placeholder={t("addClientPlaceholder")}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-black outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
        </div>
        <button
          type="submit"
          disabled={isAddingClient || newClientName.trim().length === 0}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
        >
          {isAddingClient ? t("addClientSubmitting") : t("addClientSubmit")}
        </button>
      </form>

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
