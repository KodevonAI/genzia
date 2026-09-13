import { NextResponse } from "next/server";
import { sendWebChatTurn } from "@/lib/agent/web-chat";
import { NoTenantContextError } from "@/lib/tenant/with-tenant-context";

// The `@anthropic-ai/sdk` client and the media/transcription pipeline both
// need Node APIs — not available on the Edge runtime (same reason
// app/api/uploads/brand-logo/route.ts pins this).
export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 4000;

/**
 * The web-chat endpoint (WA-05, LD-02, LD-08, plan 04-10). This route is
 * INSIDE the Clerk-authenticated area: middleware.ts protects every `/api/**`
 * route by default via an explicit public-route allowlist that does not
 * include `/api/chat` — the same "protected unless allowlisted" posture
 * Phase 1 had to fix for `/api/uploads/brand-logo` after that route was
 * accidentally excluded. No middleware change is needed here.
 *
 * Non-streaming (LD-08): the complete reply is returned as one JSON body.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { text, attachment } = body as {
    text?: unknown;
    attachment?: { base64?: unknown; mimeType?: unknown } | null;
  };

  const hasAttachment =
    typeof attachment === "object" &&
    attachment !== null &&
    typeof attachment.base64 === "string" &&
    typeof attachment.mimeType === "string";

  if (typeof text !== "string" || (text.length === 0 && !hasAttachment)) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  if (text.length > MAX_TEXT_LENGTH && !hasAttachment) {
    return NextResponse.json(
      { error: `text must be ${MAX_TEXT_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  try {
    const result = await sendWebChatTurn({
      text,
      attachment: hasAttachment
        ? {
            base64: (attachment as { base64: string }).base64,
            mimeType: (attachment as { mimeType: string }).mimeType,
          }
        : null,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ replyText: result.replyText });
  } catch (err) {
    if (err instanceof NoTenantContextError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    // Never include a provider error body or any env value in the 500 path
    // (T-04-51) — same posture as send-message.ts: log server-side, return a
    // generic message.
    console.error("POST /api/chat failed:", err);
    return NextResponse.json({ error: "No pudimos procesar tu mensaje." }, { status: 500 });
  }
}
