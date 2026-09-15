import { getLocale, getTranslations } from "next-intl/server";
import { listConversationMessagesForClient } from "@/lib/audit/list-audit-log";

const CONVERSATION_TEXT_LIMIT = 160;

function truncate(text: string | null): string {
  if (!text) return "";
  return text.length > CONVERSATION_TEXT_LIMIT
    ? `${text.slice(0, CONVERSATION_TEXT_LIMIT)}…`
    : text;
}

/**
 * Read-only playback of exactly one client's conversation history (CLI-02 /
 * D-15) — historical messages, not a live thread, so no input box, no
 * attachment button, no send button. Reuses `Bitacora`'s own i18n strings
 * (`conversationHeading`, `conversationEmpty`, `direction.*`, `team`) via a
 * genuine cross-namespace `getTranslations("Bitacora")` call — these keys
 * are deliberately NOT duplicated under `Clients` (05-05's own decision).
 * Bubble classes are copied verbatim from `chat-panel.tsx`; per
 * 05-UI-SPEC.md's Ficha Layout section 6, contact-authored
 * (`direction === "inbound"`) messages get the right-aligned/dark bubble,
 * agent-authored (`"outbound"`) the left-aligned/light bubble — the same
 * shapes `chat-panel.tsx` uses for `"user"`/`"agent"`.
 */
export async function ConversationHistory({ clientId }: { clientId: string }) {
  const [t, locale, messages] = await Promise.all([
    getTranslations("Bitacora"),
    getLocale(),
    listConversationMessagesForClient(clientId),
  ]);

  const timestampFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
        {t("conversationHeading")}
      </h2>
      {messages.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("conversationEmpty")}</p>
      ) : (
        <div className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto rounded-3xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          {messages.map((message) => {
            const isContactAuthored = message.direction === "inbound";
            return (
              <div
                key={message.id}
                className={`flex flex-col gap-1 ${isContactAuthored ? "items-end" : "items-start"}`}
              >
                <p
                  className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                    isContactAuthored
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                  }`}
                >
                  {truncate(message.textBody)}
                </p>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {timestampFormatter.format(message.createdAt)} · {t(`direction.${message.direction}`)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
