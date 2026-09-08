import { defineRouting } from "next-intl/routing";

/**
 * Locale configuration for Genzia (CTA-03: multiidioma desde v1).
 * `es` is the default locale — agencies and clients are LatAm-first.
 */
export const routing = defineRouting({
  locales: ["es", "en"],
  defaultLocale: "es",
});
