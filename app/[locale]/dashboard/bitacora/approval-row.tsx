"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { approveAction, rejectAction } from "@/lib/agent/approvals";
import type { PendingApproval } from "@/lib/agent/list-approvals";

function formatRelativeTime(date: Date, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const diffMinutes = Math.round((date.getTime() - Date.now()) / 60_000);
  if (Math.abs(diffMinutes) < 60) {
    return rtf.format(diffMinutes, "minute");
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return rtf.format(diffHours, "hour");
  }
  return rtf.format(Math.round(diffHours / 24), "day");
}

/**
 * `approveAction`/`rejectAction` (04-09) return `{ ok: false, error }`
 * rather than throwing, and this row does NOT optimistically remove itself
 * on success — `revalidatePath("/dashboard/bitacora")` inside the Server
 * Action is what actually refreshes the pending list. A failed decision
 * therefore leaves the row exactly where it was, with the error rendered
 * inline instead of disappearing or crashing.
 */
export function ApprovalRow({ approval }: { approval: PendingApproval }) {
  const t = useTranslations("Bitacora");
  const locale = useLocale();
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(decision: "approve" | "reject") {
    if (pending) return;
    setPending(decision);
    setError(null);
    const result =
      decision === "approve" ? await approveAction(approval.id) : await rejectAction(approval.id);
    setPending(null);
    if (!result.ok) {
      setError(result.error);
    }
  }

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{approval.actionLabel}</span>
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{approval.clientName ?? t("team")}</span>
            <span>{approval.channel}</span>
            {/* Computed from Date.now() on the client — a hydration mismatch
                against the server-rendered value would only ever be a
                one-minute-granularity difference, so it's suppressed rather
                than avoided with a client-only mount delay. */}
            <span suppressHydrationWarning>{formatRelativeTime(approval.createdAt, locale)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handle("approve")}
            disabled={pending !== null}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pending === "approve" ? t("deciding") : t("approve")}
          </button>
          <button
            type="button"
            onClick={() => handle("reject")}
            disabled={pending !== null}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            {pending === "reject" ? t("deciding") : t("reject")}
          </button>
        </div>
      </div>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">{approval.summary}</p>
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </li>
  );
}
