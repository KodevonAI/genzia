"use client";

import { useLocale, useTranslations } from "next-intl";
import { motion, Variants } from "motion/react";
import { CalendarClock, CreditCard, MessageCircle, Users } from "lucide-react";
import { AnimatedGroup } from "@/components/ui/animated-group";
import { Link, usePathname } from "@/i18n/navigation";

const textVariants: Variants = {
  hidden: { opacity: 0, filter: "blur(10px)", y: 20 },
  visible: {
    opacity: 1,
    filter: "blur(0px)",
    y: 0,
    transition: { type: "spring", bounce: 0.2, duration: 1 },
  },
};

const featureIcons = {
  clients: Users,
  calendar: CalendarClock,
  billing: CreditCard,
  whatsapp: MessageCircle,
} as const;

export default function HomePage() {
  const t = useTranslations("HomePage");
  const locale = useLocale();
  const pathname = usePathname();
  const otherLocale = locale === "es" ? "en" : "es";

  return (
    <div className="relative flex-1 overflow-y-auto [--color-primary:#003AF9]">
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(125%_125%_at_50%_10%,#fff_40%,var(--color-primary)_100%)] dark:bg-[radial-gradient(125%_125%_at_50%_10%,#000_40%,var(--color-primary)_100%)]" />

      <nav className="flex w-full items-center justify-between border-b border-black/10 px-4 py-4 sm:px-6 dark:border-white/20">
        <span className="text-md font-bold tracking-tight">Genzia</span>

        <div className="flex items-center gap-4">
          <Link
            href={pathname}
            locale={otherLocale}
            className="text-sm font-medium text-neutral-500 uppercase hover:text-black dark:text-white/70 dark:hover:text-white"
          >
            {otherLocale}
          </Link>
          <Link
            href="/sign-in"
            className="text-sm font-medium text-neutral-600 hover:text-black dark:text-white/70 dark:hover:text-white"
          >
            {t("nav.login")}
          </Link>
          <Link href="/sign-up">
            <button className="rounded-sm bg-(--color-primary) px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-black/90">
              {t("nav.signup")}
            </button>
          </Link>
        </div>
      </nav>

      <main className="mx-auto flex max-w-3xl flex-col items-center px-6 pt-16 pb-24 text-center sm:pt-24">
        <AnimatedGroup
          className="flex flex-col items-center"
          variants={{
            container: { visible: { transition: { staggerChildren: 0.1 } } },
            item: textVariants,
          }}
        >
          <span className="mb-5 rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-neutral-600 dark:border-white/20 dark:text-neutral-300">
            {t("badge")}
          </span>

          <h1 className="mb-5 text-3xl leading-[1.1] font-bold tracking-tight text-gray-900 md:text-4xl lg:text-5xl dark:text-white">
            {t("headline")}
          </h1>

          <p className="mx-auto mb-8 max-w-xl text-sm text-neutral-600 sm:text-base md:text-lg dark:text-neutral-300">
            {t("subtitle")}
          </p>

          <div className="mb-4 flex w-full flex-col items-center justify-center gap-4 sm:w-auto sm:flex-row">
            <Link href="/sign-up" className="w-full sm:w-auto">
              <button className="w-full cursor-pointer rounded-sm bg-(--color-primary) px-4 py-2 text-base font-medium text-white shadow-lg shadow-(--color-primary)/20 transition-all hover:bg-(--color-primary)/90 hover:shadow-(--color-primary)/40 sm:w-auto">
                {t("ctaPrimary")}
              </button>
            </Link>
            <a href="#features" className="w-full sm:w-auto">
              <button className="w-full cursor-pointer rounded-sm border border-neutral-300 px-4 py-2 text-base font-medium transition-colors hover:bg-neutral-200 sm:w-auto dark:border-neutral-700 dark:hover:bg-neutral-800">
                {t("ctaSecondary")}
              </button>
            </a>
          </div>
        </AnimatedGroup>

        <motion.div
          id="features"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
          className="mt-16 w-full scroll-mt-20"
        >
          <h2 className="mb-6 text-lg font-semibold text-gray-900 dark:text-white">
            {t("featuresHeading")}
          </h2>

          <div className="grid grid-cols-1 gap-4 text-left sm:grid-cols-2">
            {(Object.keys(featureIcons) as (keyof typeof featureIcons)[]).map(
              (key) => {
                const Icon = featureIcons[key];
                return (
                  <div
                    key={key}
                    className="rounded-md border border-black/10 bg-white/60 p-4 backdrop-blur-sm dark:border-white/10 dark:bg-white/5"
                  >
                    <Icon className="mb-2 size-5 text-(--color-primary)" />
                    <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-white">
                      {t(`features.${key}.title`)}
                    </h3>
                    <p className="text-sm text-neutral-600 dark:text-neutral-300">
                      {t(`features.${key}.description`)}
                    </p>
                  </div>
                );
              },
            )}
          </div>
        </motion.div>

        <p className="mt-12 text-xs text-neutral-500 dark:text-neutral-400">
          {t("footerNote")}
        </p>
      </main>
    </div>
  );
}
