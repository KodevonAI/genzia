import { getLocale, getTranslations } from "next-intl/server";
import type { AuditEntry } from "@/lib/audit/list-audit-log";

const RISK_BADGE_CLASS: Record<string, string> = {
  low: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  high: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  executed: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  pending_approval: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  approved_executed: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

/**
 * Plain Server Component — no client interactivity needed here, kept
 * separate from page.tsx purely for readability (three sections in one
 * file gets long fast). Every label and badge text comes from the
 * `Bitacora` i18n namespace; no hardcoded Spanish in JSX.
 */
export async function AuditList({ entries }: { entries: AuditEntry[] }) {
  const [t, locale] = await Promise.all([getTranslations("Bitacora"), getLocale()]);
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-2 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {formatter.format(entry.createdAt)}
            </span>
            <span className="text-sm font-medium">{entry.actionLabel}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {entry.clientName ?? t("team")}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                RISK_BADGE_CLASS[entry.riskLevel] ?? RISK_BADGE_CLASS.low
              }`}
            >
              {t(`risk.${entry.riskLevel}`)}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                STATUS_BADGE_CLASS[entry.status] ?? STATUS_BADGE_CLASS.executed
              }`}
            >
              {t(`status.${entry.status}`)}
            </span>
          </div>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{entry.summary}</p>
        </li>
      ))}
    </ul>
  );
}
