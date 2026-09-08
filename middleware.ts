import createMiddleware from "next-intl/middleware";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { routing } from "@/i18n/routing";

const handleI18nRouting = createMiddleware(routing);

// Public (unauthenticated) routes: the marketing homepage and, once Plan 02
// adds them, sign-in/sign-up. Next.js strips route groups like
// `(dashboard)` from the actual request URL, so a matcher literally written
// against "/(dashboard)/**" would never match a real request — silently
// protecting nothing. Instead, everything is protected by default EXCEPT
// this explicit allowlist: functionally the same scope the plan describes
// ("protect app/[locale]/(dashboard)/**, leave marketing/auth public"), but
// expressed the way route groups actually resolve, and safer by
// construction — a future page added under `app/[locale]/(dashboard)/**`
// is protected automatically, with no middleware change required.
const isPublicRoute = createRouteMatcher([
  "/",
  "/:locale",
  "/:locale/sign-in(.*)",
  "/:locale/sign-up(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
  return handleI18nRouting(req);
});

export const config = {
  matcher: [
    // Skip Next.js internals, API routes, and files with an extension.
    "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
  ],
};
