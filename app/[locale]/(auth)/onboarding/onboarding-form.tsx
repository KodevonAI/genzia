"use client";

import { useState, type FormEvent } from "react";
import { useOrganizationList } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

/**
 * CTA-01's agency-naming step. One Clerk user creates exactly one
 * organization here — Genzia's v1 model is one admin-founder per agency at
 * signup, so this deliberately does not expose Clerk's org-switcher/multi-org
 * UI. The `agencies` row itself is created asynchronously by the
 * organization.created webhook (lib/agencies/create-agency.ts), not here.
 */
export function OnboardingForm() {
  const t = useTranslations("Onboarding");
  const router = useRouter();
  const { isLoaded, createOrganization, setActive } = useOrganizationList();
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLoaded || !createOrganization || !setActive) {
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const organization = await createOrganization({ name: trimmedName });
      // Sets the session's active organization immediately, client-side, so
      // the dashboard's withTenantContext call resolves app.agency_id on
      // the very next request — no waiting for a full session refresh.
      await setActive({ organization: organization.id });
      router.push("/dashboard");
    } catch (submitError) {
      console.error("Failed to create organization", submitError);
      setError(t("error"));
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-sm flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="agency-name" className="text-sm font-medium">
          {t("agencyNameLabel")}
        </label>
        <input
          id="agency-name"
          name="agency-name"
          type="text"
          autoFocus
          required
          minLength={2}
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={!isLoaded || isSubmitting}
          placeholder={t("agencyNamePlaceholder")}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-black outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
        />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={!isLoaded || isSubmitting || name.trim().length < 2}
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {isSubmitting ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
