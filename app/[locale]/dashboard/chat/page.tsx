import { asc, desc, eq, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { conversations } from "@/lib/db/schema/conversations";
import { messages } from "@/lib/db/schema/messages";
import { getCurrentTeamMember } from "@/lib/team/current-member";
import { withTenantContext } from "@/lib/tenant/with-tenant-context";
import { ChatShell } from "./chat-shell";
import type { ChatMessage } from "./chat-panel";

/** Same cap as the agent's own history read (build-context.ts's
 * HISTORY_MESSAGE_LIMIT) — a page refresh shows the same recent window the
 * agent itself sees, not an unbounded scrollback. */
const INITIAL_HISTORY_LIMIT = 50;

/**
 * The dashboard chat surface (WA-05's "chat web", SIS-01). Team-only per
 * LD-02: authenticated by the caller's own Clerk session, MULTIPLE threads
 * per team member as of migration 0018 (superseding the "one thread" half
 * of LD-16 — see that migration's header). Loads the caller's own most
 * recently active thread through `withTenantContext` — never through the
 * plain `db` export — so a page refresh does not look like a lost
 * conversation. Auto-creates a first (empty, untitled) thread when a team
 * member has none yet, so the sidebar is never empty on first visit.
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

  const { conversationList, selectedId, initialMessages } = await withTenantContext(async (tx) => {
    let list = await tx
      .select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt })
      .from(conversations)
      .where(eq(conversations.teamMemberId, member.id))
      .orderBy(desc(conversations.updatedAt));

    if (list.length === 0) {
      const { rows } = await tx.execute<{ agency_id: string | null }>(
        sql`SELECT current_setting('app.agency_id', true) AS agency_id`,
      );
      const agencyId = rows[0]?.agency_id ?? "";
      const [created] = await tx
        .insert(conversations)
        .values({ agencyId, teamMemberId: member.id, title: null })
        .returning({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt });
      list = [created];
    }

    const firstId = list[0].id;

    const rows = await tx
      .select({
        direction: messages.direction,
        textBody: messages.textBody,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.threadId, firstId))
      .orderBy(asc(messages.createdAt))
      .limit(INITIAL_HISTORY_LIMIT);

    const chatMessages: ChatMessage[] = rows.map((row) => ({
      role: row.direction === "inbound" ? "user" : "agent",
      text: row.textBody ?? "",
      createdAt: row.createdAt.toISOString(),
    }));

    return { conversationList: list, selectedId: firstId, initialMessages: chatMessages };
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex shrink-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("subtitle")}</p>
      </div>
      <ChatShell
        initialConversations={conversationList.map((c) => ({
          id: c.id,
          title: c.title,
          updatedAt: c.updatedAt.toISOString(),
        }))}
        initialSelectedId={selectedId}
        initialMessages={initialMessages}
      />
    </div>
  );
}
