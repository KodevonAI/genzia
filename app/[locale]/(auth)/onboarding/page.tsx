import { auth } from "@clerk/nextjs/server";
import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { orgId } = await auth();

  // Genzia's v1 model is one admin-founder organization per agency, created
  // once here. A signed-in user who already has an active organization has
  // nothing left to onboard — send them straight to the dashboard instead
  // of letting them create a second, orphaned organization.
  if (orgId) {
    redirect({ href: "/dashboard", locale });
  }

  const t = await getTranslations("Onboarding");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-16 px-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <OnboardingForm />
    </div>
  );
}
