import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenantContext } from "@/lib/tenant/with-tenant-context";
import {
  getPresignedLogoUploadUrl,
  isAllowedLogoContentType,
} from "@/lib/storage/r2-client";

// AWS SDK v3's request signer needs Node's crypto module — not available
// on the Edge runtime.
export const runtime = "nodejs";

/**
 * Issues a presigned R2 PUT URL for the caller's agency logo. The app-layer
 * half of CTA-02's admin-only write: `agent_brand_config`'s RLS policy
 * (0001_rls_policies.sql) is agency-wide, not role-gated, so admin-only is
 * enforced here explicitly, not by Postgres. The actual file bytes never
 * touch this route — the browser PUTs directly to the presigned URL.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const contentType =
    typeof body === "object" && body !== null && "contentType" in body
      ? (body as { contentType?: unknown }).contentType
      : undefined;

  if (typeof contentType !== "string" || !isAllowedLogoContentType(contentType)) {
    return NextResponse.json(
      { error: "contentType must be one of image/png, image/jpeg, image/webp" },
      { status: 400 },
    );
  }

  let result: { agencyId: string; isAdmin: boolean };
  try {
    result = await withTenantContext(async (tx) => {
      // Reads the app.agency_id / app.role GUCs withTenantContext already
      // set for this transaction, rather than re-resolving the caller's
      // team_members row a second time.
      const { rows } = await tx.execute<{
        agency_id: string | null;
        role: string | null;
      }>(
        sql`SELECT current_setting('app.agency_id', true) AS agency_id, current_setting('app.role', true) AS role`,
      );
      const agencyId = rows[0]?.agency_id ?? "";
      const role = rows[0]?.role ?? null;
      return { agencyId, isAdmin: role === "admin" };
    });
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!result.isAdmin) {
    return NextResponse.json(
      { error: "Only agency admins can upload the agent logo" },
      { status: 403 },
    );
  }

  try {
    const { uploadUrl, publicUrl } = await getPresignedLogoUploadUrl(
      result.agencyId,
      contentType,
    );
    return NextResponse.json({ uploadUrl, publicUrl });
  } catch (err) {
    console.error("Failed to create presigned logo upload URL:", err);
    return NextResponse.json(
      { error: "Could not create upload URL" },
      { status: 500 },
    );
  }
}
