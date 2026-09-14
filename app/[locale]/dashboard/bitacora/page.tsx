import { getLocale, getTranslations } from "next-intl/server";
import { listAuditLog, listRecentConversationMessages } from "@/lib/audit/list-audit-log";
import { listPendingApprovals } from "@/lib/agent/list-approvals";
import { getCurrentTeamMember } from "@/lib/team/current-member";
import { ApprovalRow } from "./approval-row";
import { AuditList } from "./audit-list";

const CONVERSATION_TEXT_LIMIT = 160;

function truncate(text: string | null): string {
  if (!text) return "";
  return text.length > CONVERSATION_TEXT_LIMIT
    ? `${text.slice(0, CONVERSATION_TEXT_LIMIT)}…`
    : text;
}

/**
 * The SEG-11 / SIS-01 surface (plan 04-11): every agent action (the
 * bitácora), the pending approval queue (SEG-10) and the raw conversation
 * history, in that order. Every read below goes through `withTenantContext`
 * with NO filter of our own (LD-17) — visibility is decided entirely by
 * `audit_log_select_by_role`, `approval_queue_select_by_role` and
 * `messages_select_by_role`. There is deliberately no admin-only gating
 * anywhere on this page: SEG-11 makes the bitácora visible to the whole
 * team, and LD-03 makes team-internal (`client_id IS NULL`) entries visible
 * to every member — RLS already decides which of the rest each member sees.
 */
export default async function BitacoraPage() {
  const [t, locale, currentMember] = await Promise.all([
    getTranslations("Bitacora"),
    getLocale(),
    getCurrentTeamMember(),
  ]);

  // Same mid-provisioning window team/page.tsx and chat/page.tsx handle:
  // signed in via Clerk, `team_members` row not landed yet.
  if (!currentMember) {
    const tTeam = await getTranslations("Team");
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {tTeam("provisioning")}
      </div>
    );
  }

  const [pendingApprovals, auditEntries, conversationMessages] = await Promise.all([
    listPendingApprovals(),
    listAuditLog(),
    listRecentConversationMessages(),
  ]);

  const timestampFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("subtitle")}</p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {t("pendingHeading")}
        </h2>
        {pendingApprovals.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("pendingEmpty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {pendingApprovals.map((approval) => (
              <ApprovalRow key={approval.id} approval={approval} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {t("auditHeading")}
        </h2>
        {auditEntries.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("auditEmpty")}</p>
        ) : (
          <AuditList entries={auditEntries} />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {t("conversationHeading")}
        </h2>
        {conversationMessages.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("conversationEmpty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {conversationMessages.map((message) => (
              <li key={message.id} className="flex flex-col gap-1 py-3">
                <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>{timestampFormatter.format(message.createdAt)}</span>
                  <span>{message.channel}</span>
                  <span>{t(`direction.${message.direction}`)}</span>
                  <span>{message.clientName ?? t("team")}</span>
                </div>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  {truncate(message.textBody)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
