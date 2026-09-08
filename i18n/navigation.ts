import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Locale-aware `Link`/`redirect`/`useRouter`/`usePathname`, built on
 * `routing` (i18n/routing.ts). Every cross-page navigation added from
 * Plan 02 onward (sign-up -> onboarding -> dashboard, dashboard nav links)
 * goes through these instead of next/navigation directly, so the current
 * locale prefix is always preserved automatically.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
