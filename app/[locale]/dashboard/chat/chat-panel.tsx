"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslations } from "next-intl";

// Client-side ceilings are convenience only, not security — the server
// re-checks against lib/whatsapp/media.ts's MEDIA_LIMITS before any bytes
// reach the model.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

export type ChatMessage = {
  role: "user" | "agent";
  text: string;
  createdAt: string;
};

type PendingAttachment = { base64: string; mimeType: string; name: string };

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // FileReader's data URL prefix (e.g. "data:image/png;base64,") is not
      // part of the payload the server expects.
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ChatPanel({ initialMessages }: { initialMessages: ChatMessage[] }) {
  const t = useTranslations("Chat");
  const [transcript, setTranscript] = useState<ChatMessage[]>(initialMessages);
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const isAudio = file.type.startsWith("audio/");
    const limit = isAudio ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES;
    if (file.size > limit) {
      setError(t("tooLarge"));
      return;
    }

    setError(null);
    const base64 = await readFileAsBase64(file);
    setAttachment({ base64, mimeType: file.type, name: file.name });
  }

  function clearAttachment() {
    setAttachment(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const trimmed = text.trim();
    if (trimmed.length === 0 && !attachment) return;

    setError(null);
    setPending(true);

    const outgoing: ChatMessage = {
      role: "user",
      text: trimmed.length > 0 ? trimmed : `[${attachment?.name ?? "attachment"}]`,
      createdAt: new Date().toISOString(),
    };
    // Optimistic append — the typed text stays in the box until the request
    // actually succeeds, so nothing is lost on a failure.
    setTranscript((prev) => [...prev, outgoing]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: trimmed,
          attachment: attachment ? { base64: attachment.base64, mimeType: attachment.mimeType } : null,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setTranscript((prev) => prev.slice(0, -1));
        setError(body?.error ?? t("error"));
        return;
      }

      const { replyText } = (await res.json()) as { replyText: string };
      setTranscript((prev) => [
        ...prev,
        { role: "agent", text: replyText, createdAt: new Date().toISOString() },
      ]);
      setText("");
      setAttachment(null);
    } catch {
      setTranscript((prev) => prev.slice(0, -1));
      setError(t("error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        {transcript.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("empty")}</p>
        ) : (
          transcript.map((message, index) => (
            <div
              key={`${message.createdAt}-${index}`}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <p
                className={`max-w-[75%] whitespace-pre-wrap rounded-md px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                }`}
              >
                {message.text}
              </p>
            </div>
          ))
        )}
        {pending ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("thinking")}</p>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("placeholder")}
          rows={3}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="chat-attachment" className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("attach")}
            </label>
            <input
              id="chat-attachment"
              type="file"
              accept="image/png,image/jpeg,audio/*"
              onChange={handleAttachmentChange}
              disabled={pending}
              className="text-xs"
            />
            {attachment ? (
              <button
                type="button"
                onClick={clearAttachment}
                className="text-xs text-zinc-500 underline dark:text-zinc-400"
              >
                {attachment.name}
              </button>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-fit rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pending ? t("thinking") : t("send")}
          </button>
        </div>
      </form>
    </div>
  );
}
