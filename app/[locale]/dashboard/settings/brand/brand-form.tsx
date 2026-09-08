"use client";

import { useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { BRAND_TONES, type BrandConfig, type BrandTone } from "@/lib/brand/tone";
import { updateBrandConfig } from "@/lib/brand/update-brand-config";

const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function BrandForm({ initialValues }: { initialValues: BrandConfig }) {
  const t = useTranslations("BrandSettings");
  const [agentName, setAgentName] = useState(initialValues.agentName);
  const [tone, setTone] = useState<BrandTone>(initialValues.tone);
  // Stripped of any cache-busting query string before it's ever sent to
  // updateBrandConfig — the persisted value is always the bare public URL.
  const [logoUrl, setLogoUrl] = useState<string | null>(initialValues.logoUrl);
  // Bumped on every successful upload so the <img> below can cache-bust
  // (the R2 key is fixed per agency, so a new upload reuses the same URL as
  // the old logo). Incremented only inside the upload handler, never
  // computed from Date.now() in the render body (eslint's
  // react-hooks/purity rule flags that regardless of Server/Client —
  // see 01-fundaciones-cuenta-equipo-02-SUMMARY.md's Deviation 2).
  const [logoVersion, setLogoVersion] = useState(0);
  const [logoBroken, setLogoBroken] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  async function handleLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      setMessage({ kind: "error", text: t("errors.invalidFileType") });
      return;
    }

    setUploading(true);
    setMessage(null);
    setLogoBroken(false);

    try {
      const presignRes = await fetch("/api/uploads/brand-logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type }),
      });
      if (!presignRes.ok) throw new Error("presign-failed");
      const { uploadUrl, publicUrl } = (await presignRes.json()) as {
        uploadUrl: string;
        publicUrl: string;
      };

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error("put-failed");

      setLogoUrl(publicUrl);
      setLogoVersion((v) => v + 1);
    } catch {
      setMessage({ kind: "error", text: t("errors.uploadFailed") });
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await updateBrandConfig({ agentName, tone, logoUrl });
      if (result.success) {
        setMessage({ kind: "success", text: t("saveSuccess") });
      } else {
        setMessage({ kind: "error", text: t(`errors.${result.error}`) });
      }
    });
  }

  // Cache-bust query string is derived state, never persisted to
  // agent_brand_config.logo_url (updateBrandConfig always receives the bare
  // `logoUrl`, not `previewSrc`).
  const previewSrc = logoUrl
    ? logoVersion > 0
      ? `${logoUrl}?v=${logoVersion}`
      : logoUrl
    : null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <label htmlFor="agentName" className="text-sm font-medium">
          {t("agentNameLabel")}
        </label>
        <input
          id="agentName"
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          placeholder={t("agentNamePlaceholder")}
          maxLength={60}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="tone" className="text-sm font-medium">
          {t("toneLabel")}
        </label>
        <select
          id="tone"
          value={tone}
          onChange={(e) => setTone(e.target.value as BrandTone)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {BRAND_TONES.map((option) => (
            <option key={option} value={option}>
              {t(`tones.${option}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t("logoLabel")}</span>
        {previewSrc && !logoBroken ? (
          // R2's public host isn't (and shouldn't need to be) in
          // next/image's static remotePatterns for a per-agency,
          // runtime-configured URL.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewSrc}
            alt={t("logoAlt")}
            onError={() => setLogoBroken(true)}
            className="h-16 w-16 rounded-md border border-zinc-200 object-contain dark:border-zinc-800"
          />
        ) : previewSrc && logoBroken ? (
          <p className="text-xs text-red-600 dark:text-red-400">{t("logoBroken")}</p>
        ) : null}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleLogoChange}
          disabled={uploading}
          className="text-sm"
        />
        {uploading ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("logoUploading")}</p>
        ) : null}
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
        disabled={isPending || uploading}
        className="w-fit rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {isPending ? t("saving") : t("save")}
      </button>
    </form>
  );
}
