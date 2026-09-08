import createMiddleware from "next-intl/middleware";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { routing } from "@/i18n/routing";

const handleI18nRouting = createMiddleware(routing);

// Public (unauthenticated) routes: the marketing homepage and sign-up
// (Plan 02). Everything else — /[locale]/onboarding, /[locale]/dashboard/**
// — is protected by default via this explicit allowlist rather than a
// matcher naming those paths directly, so a future page added under
// app/[locale]/dashboard/** is protected automatically with no middleware
// change required.
//
// Note on route groups: app/[locale]/dashboard/** is a LITERAL path
// segment, not a `(dashboard)` route group. Plan 02 originally tried the
// route-group form to mirror Plan 01's file-naming convention, but Next.js
// strips route groups from the real request URL — `(dashboard)/page.tsx`
// silently resolved to `/[locale]`, the same URL as the marketing homepage
// (app/[locale]/page.tsx), and one of the two pages was dropped rather than
// erroring. Any later plan adding pages under the dashboard shell
// (Plan 03's settings/brand, Plan 04's team) must nest them under the
// literal app/[locale]/dashboard/ folder, not a `(dashboard)` group.
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
