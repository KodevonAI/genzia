"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { assignClient, unassignClient } from "@/lib/clients/assign-client";

/**
 * Assignment chips + admin-only inline reassign toggle (D-16). Reuses
 * `assignClient`/`unassignClient` verbatim and the same optimistic-toggle-
 * with-rollback pattern as `assign-clients-form.tsx`, inverted axis: this
 * component iterates team members for ONE client, not clients for ONE team
 * member. `isAdmin` is a rendering convenience only — both Server Actions
 * re-check admin status server-side regardless (T-05-20), so a non-admin
 * calling them directly still fails closed.
 */
export function AssignmentPanel({
  clientId,
  allMembers,
  initialAssignedIds,
  isAdmin,
}: {
  clientId: string;
  allMembers: { id: string; email: string }[];
  initialAssignedIds: string[];
  isAdmin: boolean;
}) {
  const t = useTranslations("Clients");
  const tTeam = useTranslations("Team");
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set(initialAssignedIds));
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assignedMembers = allMembers.filter((member) => assignedIds.has(member.id));

  async function toggle(teamMemberId: string) {
    const wasAssigned = assignedIds.has(teamMemberId);
    setError(null);
    setPendingIds((current) => new Set(current).add(teamMemberId));
    setAssignedIds((current) => {
      const next = new Set(current);
      if (wasAssigned) {
        next.delete(teamMemberId);
      } else {
        next.add(teamMemberId);
      }
      return next;
    });

    const result = wasAssigned
      ? await unassignClient(clientId, teamMemberId)
      : await assignClient(clientId, teamMemberId);

    setPendingIds((current) => {
      const next = new Set(current);
      next.delete(teamMemberId);
      return next;
    });

    if (!result.ok) {
      // Roll back to the pre-toggle state.
      setAssignedIds((current) => {
        const next = new Set(current);
        if (wasAssigned) {
          next.add(teamMemberId);
        } else {
          next.delete(teamMemberId);
        }
        return next;
      });
      setError(tTeam("errors.notAdmin"));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {t("assignmentLabel")}
        </span>
        {assignedMembers.length === 0 ? (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">{t("unassigned")}</span>
        ) : (
          assignedMembers.map((member) => (
            <span
              key={member.id}
              className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {member.email}
            </span>
          ))
        )}
        {isAdmin ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="text-xs font-medium text-zinc-500 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {t("reassign")}
          </button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {isAdmin && expanded ? (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {allMembers.map((member) => {
            const isAssigned = assignedIds.has(member.id);
            const isPending = pendingIds.has(member.id);
            return (
              <li key={member.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm">{member.email}</span>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isAssigned}
                    disabled={isPending}
                    onChange={() => toggle(member.id)}
                    className="size-4"
                  />
                  {isAssigned ? tTeam("assigned") : tTeam("unassigned")}
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
