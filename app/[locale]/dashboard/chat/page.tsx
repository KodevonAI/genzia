import { and, desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { messages } from "@/lib/db/schema/messages";
import { getCurrentTeamMember } from "@/lib/team/current-member";
import { withTenantContext } from "@/lib/tenant/with-tenant-context";
import { ChatPanel, type ChatMessage } from "./chat-panel";

/** Same cap as the agent's own history read (build-context.ts's
 * HISTORY_MESSAGE_LIMIT) — a page refresh shows the same recent window the
 * agent itself sees, not an unbounded scrollback. */
const INITIAL_HISTORY_LIMIT = 50;

/**
 * The dashboard chat surface (WA-05's "chat web", SIS-01). Team-only per
 * LD-02: authenticated by the caller's own Clerk session, one thread per
 * team member (LD-16). Loads the caller's own persisted web-chat history
 * through `withTenantContext` — never through the plain `db` export — so a
 * page refresh does not look like a lost conversation.
 */
export default async function ChatPage() {
  const t = await getTranslations("Chat");

  const member = await getCurrentTeamMember();
  if (!member) {
    const tTeam = await getTranslations("Team");
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {tTeam("provisioning")}
      </div>
    );
  }

  const rows = await withTenantContext((tx) =>
    tx
      .select({
        direction: messages.direction,
        textBody: messages.textBody,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(
        and(eq(messages.channel, "web"), eq(messages.resolvedIdentityId, member.id)),
      )
      // Most recent first so LIMIT caps the right end of a long thread;
      // reversed below back to chronological order for rendering — same
      // pattern build-context.ts uses for the agent's own history read.
      .orderBy(desc(messages.createdAt))
      .limit(INITIAL_HISTORY_LIMIT),
  );

  const initialMessages: ChatMessage[] = rows
    .slice()
    .reverse()
    .map((row) => ({
      role: row.direction === "inbound" ? "user" : "agent",
      text: row.textBody ?? "",
      createdAt: row.createdAt.toISOString(),
    }));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("subtitle")}</p>
      </div>
      <ChatPanel initialMessages={initialMessages} />
    </div>
  );
}
