import { getTranslations } from "next-intl/server";
import { getBrandConfig } from "@/lib/brand/get-brand-config";
import { BrandForm } from "./brand-form";

/**
 * CTA-02: agent branding settings (name, tone, logo). Mounted under the
 * literal app/[locale]/dashboard/ folder established by Plan 02 — NOT a
 * `(dashboard)` route group, which would silently collide with the
 * marketing homepage's URL (see 01-fundaciones-cuenta-equipo-02-SUMMARY.md).
 */
export default async function BrandSettingsPage() {
  const t = await getTranslations("BrandSettings");
  const initialValues = await getBrandConfig();

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("description")}</p>
      <BrandForm initialValues={initialValues} />
    </div>
  );
}
