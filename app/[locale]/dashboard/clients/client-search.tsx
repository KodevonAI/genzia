"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";

const DEBOUNCE_MS = 300;

/**
 * Debounced free-text search over the exact same RLS-scoped rows the member
 * already sees (D-11) — no submit button, per the UI-SPEC's light-JS bias.
 * `useSearchParams` comes from `next/navigation` directly (not
 * `@/i18n/navigation`, which doesn't export it) since search params are not
 * locale-prefixed.
 */
export function ClientSearch({ initialQuery }: { initialQuery: string }) {
  const t = useTranslations("Clients");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQuery);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const trimmed = value.trim();
      const params = new URLSearchParams(searchParams.toString());
      if (trimmed) {
        params.set("q", trimmed);
      } else {
        params.delete("q");
      }
      const queryString = params.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="text"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      placeholder={t("searchPlaceholder")}
      className="w-full max-w-md rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
    />
  );
}
