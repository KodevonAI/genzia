import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { conversations } from "@/lib/db/schema/conversations";
import { messages } from "@/lib/db/schema/messages";
import { getCurrentTeamMember } from "@/lib/team/current-member";
import { NoTenantContextError, withTenantContext } from "@/lib/tenant/with-tenant-context";

export const runtime = "nodejs";

/** Same cap the agent's own history read uses (build-context.ts's HISTORY_MESSAGE_LIMIT). */
const HISTORY_MESSAGE_LIMIT = 50;

/**
 * Loads one sidebar thread's transcript (migration 0018) when the person
 * switches to it. Scoped to the CALLER's own thread — same UX-not-security
 * filter reasoning as GET /api/chat/conversations; RLS is the actual
 * boundary either way.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const member = await getCurrentTeamMember();
    if (!member) {
      return NextResponse.json({ error: "Tu cuenta todavía se está aprovisionando." }, { status: 403 });
    }

    const result = await withTenantContext(async (tx) => {
      const [conversation] = await tx
        .select({ id: conversations.id, title: conversations.title })
        .from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.teamMemberId, member.id)));

      if (!conversation) return null;

      const rows = await tx
        .select({
          direction: messages.direction,
          textBody: messages.textBody,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(eq(messages.threadId, id))
        .orderBy(asc(messages.createdAt))
        .limit(HISTORY_MESSAGE_LIMIT);

      return { conversation, rows };
    });

    if (!result) {
      return NextResponse.json({ error: "Conversación no encontrada." }, { status: 404 });
    }

    return NextResponse.json({
      id: result.conversation.id,
      title: result.conversation.title,
      messages: result.rows.map((row) => ({
        role: row.direction === "inbound" ? "user" : "agent",
        text: row.textBody ?? "",
        createdAt: row.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    if (err instanceof NoTenantContextError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    console.error("GET /api/chat/conversations/[id] failed:", err);
    return NextResponse.json({ error: "No pudimos cargar la conversación." }, { status: 500 });
  }
}

/**
 * Deletes one thread (migration 0019). RLS (`conversations_delete_own`) is
 * the actual boundary — it only ever matches a row owned by the caller — so
 * the `teamMemberId` filter here is belt-and-suspenders, same posture as
 * every other query in this file. `messages.threadId`'s `ON DELETE CASCADE`
 * removes the thread's messages as part of the same statement.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const member = await getCurrentTeamMember();
    if (!member) {
      return NextResponse.json({ error: "Tu cuenta todavía se está aprovisionando." }, { status: 403 });
    }

    const deleted = await withTenantContext(async (tx) => {
      const [row] = await tx
        .delete(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.teamMemberId, member.id)))
        .returning({ id: conversations.id });
      return row;
    });

    if (!deleted) {
      return NextResponse.json({ error: "Conversación no encontrada." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NoTenantContextError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    console.error("DELETE /api/chat/conversations/[id] failed:", err);
    return NextResponse.json({ error: "No pudimos eliminar la conversación." }, { status: 500 });
  }
}
