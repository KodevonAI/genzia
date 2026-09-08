import { UserButton } from "@clerk/nextjs";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/**
 * The shared authenticated shell every dashboard page mounts into. Nav has
 * two placeholder slots — "Branding" (Plan 03, CTA-02 settings) and "Team"
 * (Plan 04, CTA-04/05/06 roster + assignments) — deliberately not linked
 * yet: those pages don't exist until their own plans build them.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("Dashboard");

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <Link href="/dashboard" className="text-lg font-semibold">
          Genzia
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          {/* Nav slot for Plan 03 (CTA-02 brand settings). */}
          <span className="text-zinc-400 dark:text-zinc-600">
            {t("nav.branding")}
          </span>
          {/* Nav slot for Plan 04 (CTA-04/05/06 team roster). */}
          <span className="text-zinc-400 dark:text-zinc-600">
            {t("nav.team")}
          </span>
          <UserButton />
        </nav>
      </header>
      <main className="flex flex-1 flex-col px-6 py-8">{children}</main>
    </div>
  );
}
