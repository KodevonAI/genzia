"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { motion, type PanInfo } from "motion/react";
import { Plus, MessageSquare, Trash2 } from "lucide-react";
import { ChatPanel, type ChatMessage } from "./chat-panel";

export type ConversationSummary = { id: string; title: string | null; updatedAt: string };

const SWIPE_OPEN_X = -64;
const SWIPE_OPEN_THRESHOLD = -32;

function conversationLabel(conversation: ConversationSummary, fallback: string): string {
  return conversation.title && conversation.title.trim().length > 0 ? conversation.title : fallback;
}

/**
 * One sidebar row. Drag-left-to-reveal delete (the ask: "arrastro a la
 * izquierda el chat para eliminarlo") — a red trash button sits UNDER the
 * row at all times; dragging the row left past `SWIPE_OPEN_THRESHOLD`
 * uncovers it. Only one row is "open" at a time (`openId` lives in the
 * parent), matching the standard swipe-to-delete convention (Mail, etc).
 */
function ConversationRow({
  label,
  isSelected,
  isOpen,
  isDeleting,
  onOpen,
  onClose,
  onSelect,
  onDelete,
  deleteLabel,
}: {
  label: string;
  isSelected: boolean;
  isOpen: boolean;
  isDeleting: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSelect: () => void;
  onDelete: () => void;
  deleteLabel: string;
}) {
  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x < SWIPE_OPEN_THRESHOLD) onOpen();
    else onClose();
  }

  return (
    <div className="relative overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={onDelete}
        disabled={isDeleting}
        aria-label={deleteLabel}
        className="absolute inset-y-0 right-0 flex w-16 items-center justify-center bg-red-600 text-white transition hover:bg-red-500 disabled:opacity-50"
      >
        <Trash2 size={16} />
      </button>
      <motion.button
        type="button"
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: SWIPE_OPEN_X, right: 0 }}
        dragElastic={0.02}
        dragMomentum={false}
        animate={{ x: isOpen ? SWIPE_OPEN_X : 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        onDragEnd={handleDragEnd}
        onClick={() => (isOpen ? onClose() : onSelect())}
        className={`relative flex w-full items-center gap-2 truncate rounded-xl bg-white px-3 py-2.5 text-left text-sm transition dark:bg-zinc-900 ${
          isSelected
            ? "!bg-zinc-900 text-white dark:!bg-zinc-100 dark:text-zinc-900"
            : "text-zinc-700 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }`}
      >
        <MessageSquare size={14} className="shrink-0 opacity-70" />
        <span className="truncate">{label}</span>
      </motion.button>
    </div>
  );
}

/**
 * Sidebar + panel shell for the dashboard chat surface (migration 0018/0019
 * — multiple named threads per team member, superseding the "no thread
 * management UI" half of LD-16). Switching conversations remounts
 * `ChatPanel` via its `key` prop rather than lifting its transcript state up
 * here — that panel already owns the full send/attach/error lifecycle for
 * ONE thread, and a remount is the simplest way to reset it cleanly for a
 * different one.
 *
 * The sidebar list only ever shows THIS caller's own conversations — both
 * `/api/chat/conversations` and `/api/chat/conversations/[id]` filter by
 * the caller's `teamMemberId` server-side, so no fetch here can surface a
 * teammate's threads even though RLS itself (LD-03 parity) would allow a
 * broader read.
 */
export function ChatShell({
  initialConversations,
  initialSelectedId,
  initialMessages,
}: {
  initialConversations: ConversationSummary[];
  initialSelectedId: string;
  initialMessages: ChatMessage[];
}) {
  const t = useTranslations("Chat");
  const [conversationList, setConversationList] = useState<ConversationSummary[]>(initialConversations);
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [messagesByThread, setMessagesByThread] = useState<Record<string, ChatMessage[]>>({
    [initialSelectedId]: initialMessages,
  });
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshList() {
    try {
      const res = await fetch("/api/chat/conversations");
      if (!res.ok) return;
      const { conversations: rows } = (await res.json()) as { conversations: ConversationSummary[] };
      setConversationList(rows);
    } catch {
      // Best-effort — the sidebar just keeps its previous order/titles.
    }
  }

  async function loadConversation(id: string): Promise<ChatMessage[] | null> {
    setLoadingId(id);
    try {
      const res = await fetch(`/api/chat/conversations/${id}`);
      if (!res.ok) return null;
      const data = (await res.json()) as { messages: ChatMessage[] };
      setMessagesByThread((prev) => ({ ...prev, [id]: data.messages }));
      return data.messages;
    } finally {
      setLoadingId(null);
    }
  }

  async function selectConversation(id: string) {
    setOpenId(null);
    if (id === selectedId) return;
    setError(null);

    if (messagesByThread[id]) {
      setSelectedId(id);
      return;
    }

    const loaded = await loadConversation(id);
    if (loaded === null) {
      setError(t("loadError"));
      return;
    }
    setSelectedId(id);
  }

  async function createConversation() {
    if (creating) return;
    setCreating(true);
    setError(null);
    setOpenId(null);
    try {
      const res = await fetch("/api/chat/conversations", { method: "POST" });
      if (!res.ok) {
        setError(t("loadError"));
        return;
      }
      const { conversation } = (await res.json()) as { conversation: ConversationSummary };
      setConversationList((prev) => [conversation, ...prev]);
      setMessagesByThread((prev) => ({ ...prev, [conversation.id]: [] }));
      setSelectedId(conversation.id);
    } catch {
      setError(t("loadError"));
    } finally {
      setCreating(false);
    }
  }

  async function deleteConversation(id: string) {
    if (deletingId) return;
    setDeletingId(id);
    setError(null);

    const previousList = conversationList;
    const remaining = previousList.filter((c) => c.id !== id);
    setConversationList(remaining);
    setOpenId(null);

    try {
      const res = await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setConversationList(previousList);
        setError(t("deleteError"));
        return;
      }

      setMessagesByThread((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });

      if (id !== selectedId) return;

      if (remaining.length > 0) {
        const nextId = remaining[0].id;
        if (!messagesByThread[nextId]) await loadConversation(nextId);
        setSelectedId(nextId);
        return;
      }

      // Deleted the last thread — create a fresh empty one so the panel
      // always has somewhere to send the next message.
      const res2 = await fetch("/api/chat/conversations", { method: "POST" });
      if (res2.ok) {
        const { conversation } = (await res2.json()) as { conversation: ConversationSummary };
        setConversationList([conversation]);
        setMessagesByThread((prev) => ({ ...prev, [conversation.id]: [] }));
        setSelectedId(conversation.id);
      }
    } catch {
      setConversationList(previousList);
      setError(t("deleteError"));
    } finally {
      setDeletingId(null);
    }
  }

  const activeMessages = messagesByThread[selectedId] ?? [];

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <aside className="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto rounded-3xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
        <button
          type="button"
          onClick={createConversation}
          disabled={creating}
          className="flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          <Plus size={16} />
          {t("newChat")}
        </button>

        <div className="flex flex-col gap-1 overflow-y-auto">
          {conversationList.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
              {t("conversationsEmpty")}
            </p>
          ) : (
            conversationList.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                label={conversationLabel(conversation, t("untitled"))}
                isSelected={conversation.id === selectedId}
                isOpen={openId === conversation.id}
                isDeleting={deletingId === conversation.id}
                onOpen={() => setOpenId(conversation.id)}
                onClose={() => setOpenId(null)}
                onSelect={() => selectConversation(conversation.id)}
                onDelete={() => deleteConversation(conversation.id)}
                deleteLabel={t("delete")}
              />
            ))
          )}
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        {loadingId === selectedId && !messagesByThread[selectedId] ? null : (
          <ChatPanel
            key={selectedId}
            threadId={selectedId}
            initialMessages={activeMessages}
            onActivity={refreshList}
          />
        )}
      </div>
    </div>
  );
}
