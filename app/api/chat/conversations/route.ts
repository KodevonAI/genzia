import { desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { conversations } from "@/lib/db/schema/conversations";
import { getCurrentTeamMember } from "@/lib/team/current-member";
import { NoTenantContextError, withTenantContext } from "@/lib/tenant/with-tenant-context";

// Same runtime pin as /api/chat — withTenantContext needs Node, not Edge.
export const runtime = "nodejs";

/**
 * Sidebar list (migration 0018). RLS (`conversations_select_by_role`) would
 * let any team member read the whole agency's conversations — same LD-03
 * transparency `messages`/`audit_log`/`approval_queue` already have — but
 * this endpoint additionally filters to the CALLER's own conversations.
 * That extra filter is a UX choice (a person's sidebar shows their own
 * threads), not a security boundary: RLS is still the actual enforcement,
 * this just narrows what one sidebar happens to display.
 */
export async function GET() {
  try {
    const member = await getCurrentTeamMember();
    if (!member) {
      return NextResponse.json({ error: "Tu cuenta todavía se está aprovisionando." }, { status: 403 });
    }

    const rows = await withTenantContext((tx) =>
      tx
        .select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt })
        .from(conversations)
        .where(eq(conversations.teamMemberId, member.id))
        .orderBy(desc(conversations.updatedAt)),
    );

    return NextResponse.json({
      conversations: rows.map((row) => ({
        id: row.id,
        title: row.title,
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    if (err instanceof NoTenantContextError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    console.error("GET /api/chat/conversations failed:", err);
    return NextResponse.json({ error: "No pudimos cargar tus conversaciones." }, { status: 500 });
  }
}

/** Creates an empty new thread — RLS (`conversations_insert_own`) pins it to the caller. */
export async function POST() {
  try {
    const member = await getCurrentTeamMember();
    if (!member) {
      return NextResponse.json({ error: "Tu cuenta todavía se está aprovisionando." }, { status: 403 });
    }

    const row = await withTenantContext(async (tx) => {
      const { rows } = await tx.execute<{ agency_id: string | null }>(
        sql`SELECT current_setting('app.agency_id', true) AS agency_id`,
      );
      const agencyId = rows[0]?.agency_id ?? "";

      const [inserted] = await tx
        .insert(conversations)
        .values({ agencyId, teamMemberId: member.id, title: null })
        .returning({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt });

      return inserted;
    });

    return NextResponse.json({
      conversation: { id: row.id, title: row.title, updatedAt: row.updatedAt.toISOString() },
    });
  } catch (err) {
    if (err instanceof NoTenantContextError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    console.error("POST /api/chat/conversations failed:", err);
    return NextResponse.json({ error: "No pudimos crear la conversación." }, { status: 500 });
  }
}
