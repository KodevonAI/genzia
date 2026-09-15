"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClientAction } from "@/lib/clients/create-client-action";
import { updateClientAction } from "@/lib/clients/update-client-action";
import { CLIENT_INDUSTRY_CODES } from "@/lib/clients/industries";

type ClientFormValues = {
  name: string;
  phone: string | null;
  email: string | null;
  industry: string | null;
  notes: string | null;
};

type ClientFormProps =
  | { mode: "create" }
  | { mode: "edit"; clientId: string; initialValues: ClientFormValues };

/**
 * Shared create/edit form (CLI-01's "por formulario" half, CLI-03's edit),
 * following `brand-form.tsx`'s exact controlled-input + Server Action +
 * typed-error-union pattern. Never sends agencyId/identity — only the plain
 * field values, per `createClientAction`/`updateClientAction`'s own
 * signatures (T-05-18).
 */
export function ClientForm(props: ClientFormProps) {
  const t = useTranslations("Clients");
  const router = useRouter();
  const isEdit = props.mode === "edit";

  const [name, setName] = useState(isEdit ? props.initialValues.name : "");
  const [phone, setPhone] = useState(isEdit ? props.initialValues.phone ?? "" : "");
  const [email, setEmail] = useState(isEdit ? props.initialValues.email ?? "" : "");
  const [industry, setIndustry] = useState(isEdit ? props.initialValues.industry ?? "" : "");
  const [notes, setNotes] = useState(isEdit ? props.initialValues.notes ?? "" : "");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);

    startTransition(async () => {
      const input = {
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        industry: industry || undefined,
        notes: notes.trim() || undefined,
      };

      if (isEdit) {
        const result = await updateClientAction(props.clientId, input);
        if (result.success) {
          router.push(`/dashboard/clients/${props.clientId}`);
          return;
        }
        setErrorFromResult(result.error);
        return;
      }

      const result = await createClientAction(input);
      if (result.success) {
        router.push(`/dashboard/clients/${result.clientId}`);
        return;
      }
      setErrorFromResult(result.error);
    });
  }

  // D-02's own copy conflates the name-required and contact-required cases
  // into one sentence ("El nombre es obligatorio. Agrega también un
  // teléfono o un correo.") — reused as-is for both (and for
  // invalidIndustry), per the UI-SPEC's own wording choice, rather than
  // inventing a second string. Every other error (notFound/forbidden/
  // unknown) falls back to the generic saveFailed copy — never a raw code.
  function setErrorFromResult(
    error: "nameRequired" | "contactRequired" | "invalidIndustry" | "notFound" | "forbidden" | "unknown",
  ) {
    if (error === "nameRequired" || error === "contactRequired" || error === "invalidIndustry") {
      setMessage({ kind: "error", text: t("errors.nameRequired") });
    } else {
      setMessage({ kind: "error", text: t("errors.saveFailed") });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-sm font-medium">
          {t("nameLabel")}
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("namePlaceholder")}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div className="flex flex-wrap gap-6">
        <div className="flex flex-col gap-1">
          <label htmlFor="phone" className="text-sm font-medium">
            {t("phoneLabel")}
          </label>
          <input
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t("phonePlaceholder")}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium">
            {t("emailLabel")}
          </label>
          <input
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("emailPlaceholder")}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="industry" className="text-sm font-medium">
          {t("industryLabel")}
        </label>
        <select
          id="industry"
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">{t("industries.notSpecified")}</option>
          {CLIENT_INDUSTRY_CODES.map((code) => (
            <option key={code} value={code}>
              {t(`industries.${code}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="notes" className="text-sm font-medium">
          {t("notesLabel")}
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("notesPlaceholder")}
          rows={4}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <p className="text-xs text-zinc-500">{t("notesTeamOnlyCaption")}</p>
      </div>

      {message ? (
        <p
          className={
            message.kind === "success"
              ? "text-sm text-green-700 dark:text-green-400"
              : "text-sm text-red-600 dark:text-red-400"
          }
        >
          {message.text}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="w-fit rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {isEdit
          ? isPending
            ? t("editSubmitting")
            : t("editSubmit")
          : isPending
            ? t("createSubmitting")
            : t("createSubmit")}
      </button>
    </form>
  );
}
