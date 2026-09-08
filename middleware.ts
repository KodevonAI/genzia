import createMiddleware from "next-intl/middleware";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { routing } from "@/i18n/routing";

const handleI18nRouting = createMiddleware(routing);

// Public (unauthenticated) routes: the marketing homepage, sign-up (Plan
// 02), and the Clerk webhook (verified via its own Svix signature, not a
// user session — see app/api/webhooks/clerk/route.ts). Everything else —
// /[locale]/onboarding, /[locale]/dashboard/**, and every OTHER /api/**
// route (e.g. /api/uploads/brand-logo, Plan 03) — is protected by default
// via this explicit allowlist rather than a matcher naming those paths
// directly, so a future page or API route is protected automatically with
// no middleware change required.
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
  "/api/webhooks(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }

  // API routes carry no locale segment (e.g. /api/uploads/brand-logo, not
  // /es/api/uploads/brand-logo) — next-intl's middleware doesn't apply to
  // them and would otherwise try to rewrite them onto a locale-prefixed
  // path. The auth.protect() above still runs for them (unless allowlisted
  // above), which is the actual reason this middleware must process
  // /api/** at all: without it, auth() inside a Route Handler like
  // app/api/uploads/brand-logo/route.ts never gets a resolved Clerk
  // session, and withTenantContext fails as if the caller were signed out
  // even when they aren't.
  if (req.nextUrl.pathname.startsWith("/api") || req.nextUrl.pathname.startsWith("/trpc")) {
    return;
  }

  return handleI18nRouting(req);
});

export const config = {
  matcher: [
    // Skip Next.js internals and files with an extension; API/tRPC routes
    // ARE matched (see comment above) so Clerk's auth context is available
    // inside them.
    "/((?!_next|_vercel|.*\\..*).*)",
    "/(api|trpc)(.*)",
  ],
};
