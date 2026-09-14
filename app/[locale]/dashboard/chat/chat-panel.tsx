"use client";

import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { Paperclip, Send, X } from "lucide-react";

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
  const [focused, setFocused] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-3xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
        {transcript.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("empty")}</p>
        ) : (
          <AnimatePresence initial={false}>
            {transcript.map((message, index) => (
              <motion.div
                key={`${message.createdAt}-${index}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <p
                  className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                    message.role === "user"
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                  }`}
                >
                  {message.text}
                </p>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
        {pending ? (
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </span>
            {t("thinking")}
          </div>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <AnimatePresence>
          {attachment ? (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-2 overflow-hidden px-1"
            >
              <span className="flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                <Paperclip size={12} />
                {attachment.name}
                <button
                  type="button"
                  onClick={clearAttachment}
                  className="ml-1 rounded-full p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  aria-label={t("attach")}
                >
                  <X size={12} />
                </button>
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <motion.div
          animate={{
            boxShadow: focused
              ? "0 8px 28px 0 rgba(0,0,0,0.10)"
              : "0 1px 4px 0 rgba(0,0,0,0.06)",
          }}
          transition={{ type: "spring", stiffness: 200, damping: 24 }}
          className="flex items-end gap-2 rounded-3xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={pending}
            title={t("attach")}
            className="shrink-0 rounded-full p-2.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <Paperclip size={18} />
          </button>
          <input
            ref={fileInputRef}
            id="chat-attachment"
            type="file"
            accept="image/png,image/jpeg,audio/*"
            onChange={handleAttachmentChange}
            disabled={pending}
            className="hidden"
          />

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={t("placeholder")}
            rows={1}
            className="max-h-40 flex-1 resize-none border-0 bg-transparent py-2.5 text-sm outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
          />

          <button
            type="submit"
            disabled={pending}
            title={t("send")}
            className="flex shrink-0 items-center justify-center rounded-full bg-zinc-900 p-2.5 text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <Send size={18} />
          </button>
        </motion.div>
      </form>
    </div>
  );
}
