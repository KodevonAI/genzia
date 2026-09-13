import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { processAgentTurn } from "@/inngest/functions/process-agent-turn";

/**
 * Inngest's own HTTP endpoint. Inngest discovers registered functions here
 * and calls back into this route to execute each step, which is exactly why
 * a background step actually completes on a serverless host: the work runs in
 * a separate invocation triggered by Inngest, not by the webhook function
 * "staying alive" after it returned 200 (RESEARCH.md Pitfall 6).
 *
 * Signature verification for these requests is handled inside the SDK, unlike
 * app/api/webhooks/clerk/route.ts and app/api/webhooks/meta/route.ts which
 * verify their own. Same discipline otherwise: this file is wiring only, all
 * real logic lives in inngest/functions/.
 *
 * `runtime = "nodejs"` for the same reason as the other webhook routes — the
 * functions served here open a Postgres pool and use Node's crypto.
 */
export const runtime = "nodejs";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processAgentTurn],
});
