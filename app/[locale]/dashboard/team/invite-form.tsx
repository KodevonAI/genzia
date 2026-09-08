"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { inviteMember } from "@/lib/team/invite-member";

const ERROR_KEYS: Record<string, string> = {
  not_admin: "errors.notAdmin",
  invalid_email: "errors.invalidEmail",
  invalid_role: "errors.invalidRole",
  invalid_whatsapp: "errors.invalidWhatsapp",
  already_invited: "errors.alreadyInvited",
  clerk_error: "errors.clerkError",
};

/**
 * Admin-only invite form (CTA-04) — only ever rendered by team/page.tsx when
 * `isAdmin` is true, but `inviteMember` itself re-checks admin status
 * server-side regardless (see lib/team/current-member.ts), so hiding this
 * form is a UX convenience, not the actual access-control boundary.
 */
export function InviteForm() {
  const t = useTranslations("Team");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const result = await inviteMember({ email, role, whatsappNumber });
      if (!result.ok) {
        setError(t(ERROR_KEYS[result.error] ?? "errors.clerkError"));
        setIsSubmitting(false);
        return;
      }
      setEmail("");
      setWhatsappNumber("");
      setRole("member");
      setIsSubmitting(false);
      router.refresh();
    } catch (submitError) {
      console.error("Failed to invite team member", submitError);
      setError(t("errors.clerkError"));
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 className="text-sm font-medium">{t("inviteHeading")}</h2>
      <div className="flex flex-wrap gap-4">
        <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
          <label htmlFor="invite-email" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t("emailLabel")}
          </label>
          <input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={isSubmitting}
            placeholder={t("emailPlaceholder")}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-black outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
        </div>
        <div className="flex min-w-[10rem] flex-col gap-1">
          <label htmlFor="invite-role" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t("roleLabel")}
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value as "member" | "admin")}
            disabled={isSubmitting}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-black outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            <option value="member">{t("role.member")}</option>
            <option value="admin">{t("role.admin")}</option>
          </select>
        </div>
        <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <label htmlFor="invite-whatsapp" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t("whatsappLabel")}
          </label>
          <input
            id="invite-whatsapp"
            type="tel"
            required
            value={whatsappNumber}
            onChange={(event) => setWhatsappNumber(event.target.value)}
            disabled={isSubmitting}
            placeholder={t("whatsappPlaceholder")}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-black outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
        </div>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-fit rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {isSubmitting ? t("inviteSubmitting") : t("inviteSubmit")}
      </button>
    </form>
  );
}
