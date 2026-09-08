"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

// The `agencies` row is created asynchronously by the organization.created
// webhook (lib/agencies/create-agency.ts) — there's a brief, real window
// right after signup where the Clerk organization exists but the row
// hasn't landed yet. This polls a capped number of times via
// `router.refresh()` (re-running the server component's DB read) rather
// than assuming synchronous consistency between Clerk and Postgres.
const MAX_POLL_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 2000;

export function SettingUpAccount() {
  const t = useTranslations("Dashboard");
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (attempts >= MAX_POLL_ATTEMPTS) {
      return;
    }

    const timer = setTimeout(() => {
      setAttempts((current) => current + 1);
      router.refresh();
    }, POLL_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [attempts, router]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-32 text-center">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {t("settingUp")}
      </p>
    </div>
  );
}
