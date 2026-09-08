import { UserButton } from "@clerk/nextjs";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/**
 * The shared authenticated shell every dashboard page mounts into.
 * "Branding" (Plan 03, CTA-02 settings) links to /dashboard/settings/brand.
 * "Team" (Plan 04, CTA-04/05/06 roster + assignments) links to
 * /dashboard/team — the literal path segment, NOT a `(dashboard)` route
 * group (see middleware.ts).
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
          <Link href="/dashboard/settings/brand" className="hover:underline">
            {t("nav.branding")}
          </Link>
          <Link href="/dashboard/team" className="hover:underline">
            {t("nav.team")}
          </Link>
          <UserButton />
        </nav>
      </header>
      <main className="flex flex-1 flex-col px-6 py-8">{children}</main>
    </div>
  );
}
