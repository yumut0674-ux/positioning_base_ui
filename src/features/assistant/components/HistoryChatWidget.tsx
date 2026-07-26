"use client";

import { Bot, Loader2, MessageCircle, SendHorizontal, Trash2, User, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import styles from "./historyChatWidget.module.css";

type HistoryChatWidgetProps = {
  tagCode?: string;
  entityName?: string;
  from?: string;
  to?: string;
  floorPlanId?: string;
  draftText?: string;
  draftRequestId?: number;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
};

type AssistantApiResponse = {
  data?: {
    sessionId: string;
    answer: string;
  };
  error?: string;
};

function normalizeOptional(value?: string): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function createMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toDisplayText(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .trim();
}

export function HistoryChatWidget({
  tagCode,
  entityName,
  from,
  to,
  floorPlanId,
  draftText,
  draftRequestId,
}: HistoryChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shouldPlaceCaretAtEndRef = useRef(false);

  const context = useMemo(() => ({
    tagCode: normalizeOptional(tagCode),
    entityName: normalizeOptional(entityName),
    from: normalizeOptional(from),
    to: normalizeOptional(to),
    floorPlanId: normalizeOptional(floorPlanId),
  }), [entityName, floorPlanId, from, tagCode, to]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [isOpen, loading, messages]);

  useEffect(() => {
    if (!isOpen) return;
    textareaRef.current?.focus();
  }, [isOpen]);

  const placeCaretAtEnd = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return false;
    const caretPosition = textarea.value.length;
    textarea.focus();
    textarea.setSelectionRange(caretPosition, caretPosition);
    return true;
  }, []);

  useEffect(() => {
    if (!draftRequestId || !draftText?.trim()) return;
    const nextInput = `${draftText.trim()} `;
    shouldPlaceCaretAtEndRef.current = true;
    setIsOpen(true);
    setInput(nextInput);
  }, [draftRequestId, draftText]);

  useEffect(() => {
    if (!isOpen || !shouldPlaceCaretAtEndRef.current) return;
    const didPlaceCaret = placeCaretAtEnd();
    if (didPlaceCaret) {
      shouldPlaceCaretAtEndRef.current = false;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      if (placeCaretAtEnd()) shouldPlaceCaretAtEndRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [input, isOpen, placeCaretAtEnd]);

  const appendAssistantError = useCallback((content: string) => {
    setMessages((current) => [
      ...current,
      { id: createMessageId(), role: "assistant", content, isError: true },
    ]);
    setLastError(content);
  }, []);

  const sendMessage = useCallback(async () => {
    const message = input.trim();
    if (!message || loading) return;

    setInput("");
    setLoading(true);
    setLastError(null);
    setMessages((current) => [
      ...current,
      { id: createMessageId(), role: "user", content: message },
    ]);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          message,
          sessionId,
          context,
        }),
      });
      const payload = await response.json().catch(() => ({})) as AssistantApiResponse;

      if (!response.ok || !payload.data) {
        appendAssistantError(payload.error ?? "Konum asistanı şu anda yanıt veremiyor.");
        return;
      }

      const data = payload.data;
      setSessionId(data.sessionId);
      setMessages((current) => [
        ...current,
        { id: createMessageId(), role: "assistant", content: toDisplayText(data.answer) },
      ]);
    } catch {
      appendAssistantError("Konum asistanı şu anda çevrimdışı.");
    } finally {
      setLoading(false);
    }
  }, [appendAssistantError, context, input, loading, sessionId]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage();
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const clearConversation = async () => {
    const currentSessionId = sessionId;
    setMessages([]);
    setInput("");
    setLastError(null);
    setSessionId(undefined);
    if (currentSessionId) {
      await fetch(`/api/assistant?sessionId=${encodeURIComponent(currentSessionId)}`, {
        method: "DELETE",
      }).catch(() => undefined);
    }
    textareaRef.current?.focus();
  };

  return (
    <div className={styles.widgetRoot}>
      {isOpen && (
        <section
          className={styles.panel}
          role="dialog"
          aria-labelledby="history-chat-title"
        >
          <header className={styles.header}>
            <div className={styles.titleBlock}>
              <span className={styles.botBadge} aria-hidden="true"><Bot size={16} /></span>
              <div>
                <h2 id="history-chat-title">Konum Asistanı</h2>
                <span className={`${styles.status} ${lastError ? styles.statusError : ""}`}>
                  <i aria-hidden="true" />
                  {lastError ? "Bağlantı hatası" : "Çevrimiçi"}
                </span>
              </div>
            </div>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => setIsOpen(false)}
              aria-label="Konum asistanı panelini kapat"
              title="Kapat"
            >
              <X size={16} />
            </button>
          </header>

          <div className={styles.messages} aria-live="polite">
            {messages.length === 0 && (
              <div className={styles.emptyState}>
                <Bot size={18} />
                <p>Seçili varlık ve tarih aralığı için konum verisine soru sorun.</p>
              </div>
            )}
            {messages.map((message) => (
              <article
                key={message.id}
                className={`${styles.messageRow} ${message.role === "user" ? styles.userRow : styles.assistantRow}`}
              >
                <span className={styles.avatar} aria-hidden="true">
                  {message.role === "user" ? <User size={13} /> : <Bot size={13} />}
                </span>
                <p className={`${styles.bubble} ${message.isError ? styles.errorBubble : ""}`}>
                  {message.role === "assistant" ? toDisplayText(message.content) : message.content}
                </p>
              </article>
            ))}
            {loading && (
              <div className={`${styles.messageRow} ${styles.assistantRow}`}>
                <span className={styles.avatar} aria-hidden="true"><Bot size={13} /></span>
                <p className={styles.typingBubble}><Loader2 size={14} className={styles.spin} /> Yanıt hazırlanıyor</p>
              </div>
            )}
            <div ref={messageEndRef} />
          </div>

          <form className={styles.composer} onSubmit={handleSubmit}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value.slice(0, 1000))}
              onKeyDown={handleComposerKeyDown}
              placeholder="Konum geçmişini sorun"
              rows={2}
              maxLength={1000}
              aria-label="Konum asistanına mesaj yaz"
            />
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.clearButton}
                onClick={clearConversation}
                disabled={loading || messages.length === 0}
              >
                <Trash2 size={13} /> Konuşmayı temizle
              </button>
              <button
                type="submit"
                className={styles.sendButton}
                disabled={loading || input.trim().length === 0}
                aria-label="Mesaj gönder"
                title="Gönder"
              >
                {loading ? <Loader2 size={16} className={styles.spin} /> : <SendHorizontal size={16} />}
              </button>
            </div>
          </form>
        </section>
      )}

      {!isOpen && (
        <button
          type="button"
          className={styles.launchButton}
          onClick={() => setIsOpen(true)}
          aria-label="Konum asistanını aç"
          aria-expanded={false}
          title="Konum Asistanı"
        >
          <MessageCircle size={22} />
        </button>
      )}
    </div>
  );
}
