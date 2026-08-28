"use client";

import { Bot, Loader2, MessageCircle, SendHorizontal, Trash2, User, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import styles from "./historyChatWidget.module.css";

const PANEL_WIDTH_STORAGE_KEY = "gekon-ai-panel-width";
const DEFAULT_PANEL_WIDTH = 390;
const MIN_PANEL_WIDTH = 360;
const MOBILE_BREAKPOINT = 640;

export type GekonAiRoutePoint = {
  readonly x: number;
  readonly y: number;
  readonly observedAt: string;
  readonly zoneName?: string;
};

export type GekonAiContext = {
  readonly mode?: "live" | "history";
  readonly selectedTagId?: string;
  readonly tagCode?: string;
  readonly entityName?: string;
  readonly from?: string;
  readonly to?: string;
  readonly floorPlanId?: string;
  readonly floorPlanName?: string;
  readonly tagStatus?: string;
  readonly zoneName?: string;
  readonly livePosition?: {
    readonly x: number;
    readonly y: number;
    readonly observedAt: string;
  };
  readonly history?: {
    readonly returnedCount: number;
    readonly sourcePointCount: number;
    readonly sampled: boolean;
    readonly distanceMeters: number;
  };
  readonly historyPoints?: readonly GekonAiRoutePoint[];
};

type GekonAiWidgetProps = {
  readonly context?: GekonAiContext;
  readonly draftText?: string;
  readonly draftRequestId?: number;
};

type HistoryChatWidgetProps = {
  readonly tagCode?: string;
  readonly entityName?: string;
  readonly from?: string;
  readonly to?: string;
  readonly floorPlanId?: string;
  readonly draftText?: string;
  readonly draftRequestId?: number;
  readonly history?: GekonAiContext["history"];
  readonly historyPoints?: readonly GekonAiRoutePoint[];
};

type ChatMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly isError?: boolean;
};

type AssistantApiResponse = {
  readonly data?: {
    readonly sessionId: string;
    readonly answer: string;
  };
  readonly error?: string;
};

type ResizeSession = {
  readonly pointerId: number;
  readonly startX: number;
  readonly startWidth: number;
  currentWidth: number;
};

function normalizeOptional(value?: string): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function createMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
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

export function GekonAiWidget({ context: suppliedContext, draftText, draftRequestId }: GekonAiWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shouldPlaceCaretAtEndRef = useRef(false);
  const resizeSessionRef = useRef<ResizeSession | null>(null);

  const context = useMemo<GekonAiContext>(() => ({
    ...suppliedContext,
    selectedTagId: normalizeOptional(suppliedContext?.selectedTagId),
    tagCode: normalizeOptional(suppliedContext?.tagCode),
    entityName: normalizeOptional(suppliedContext?.entityName),
    from: normalizeOptional(suppliedContext?.from),
    to: normalizeOptional(suppliedContext?.to),
    floorPlanId: normalizeOptional(suppliedContext?.floorPlanId),
    floorPlanName: normalizeOptional(suppliedContext?.floorPlanName),
    tagStatus: normalizeOptional(suppliedContext?.tagStatus),
    zoneName: normalizeOptional(suppliedContext?.zoneName),
    historyPoints: suppliedContext?.historyPoints?.slice(0, 200),
  }), [suppliedContext]);

  const clampPanelWidth = useCallback((width: number) => {
    if (typeof window === "undefined") return Math.max(MIN_PANEL_WIDTH, width);
    const maxWidth = Math.max(MIN_PANEL_WIDTH, Math.floor(window.innerWidth * .6));
    return Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, Math.round(width)));
  }, []);

  const persistPanelWidth = useCallback((width: number) => {
    window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(clampPanelWidth(width)));
  }, [clampPanelWidth]);

  useEffect(() => {
    const storedWidth = Number(window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
    if (!Number.isFinite(storedWidth)) return;
    const restoreWidth = window.setTimeout(() => setPanelWidth(clampPanelWidth(storedWidth)), 0);
    return () => window.clearTimeout(restoreWidth);
  }, [clampPanelWidth]);

  useEffect(() => {
    const handleViewportResize = () => setPanelWidth((current) => clampPanelWidth(current));
    window.addEventListener("resize", handleViewportResize);
    return () => window.removeEventListener("resize", handleViewportResize);
  }, [clampPanelWidth]);

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
    const timer = window.setTimeout(() => {
      shouldPlaceCaretAtEndRef.current = true;
      setIsOpen(true);
      setInput(`${draftText.trim()} `);
    }, 0);
    return () => window.clearTimeout(timer);
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
    setMessages((current) => [...current, { id: createMessageId(), role: "assistant", content, isError: true }]);
    setLastError(content);
  }, []);

  const sendMessage = useCallback(async () => {
    const message = input.trim();
    if (!message || loading) return;

    setInput("");
    setLoading(true);
    setLastError(null);
    setMessages((current) => [...current, { id: createMessageId(), role: "user", content: message }]);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ message, sessionId, context }),
      });
      const payload = await response.json().catch(() => ({})) as AssistantApiResponse;
      if (!response.ok || !payload.data) {
        appendAssistantError(payload.error ?? "Gekon AI şu anda yanıt veremiyor.");
        return;
      }
      setSessionId(payload.data.sessionId);
      setMessages((current) => [...current, {
        id: createMessageId(),
        role: "assistant",
        content: toDisplayText(payload.data!.answer),
      }]);
    } catch {
      appendAssistantError("Gekon AI bağlantısı kesildi.");
    } finally {
      setLoading(false);
    }
  }, [appendAssistantError, context, input, loading, sessionId]);

  const clearConversation = async () => {
    const currentSessionId = sessionId;
    setMessages([]);
    setInput("");
    setLastError(null);
    setSessionId(undefined);
    if (currentSessionId) {
      await fetch(`/api/assistant?sessionId=${encodeURIComponent(currentSessionId)}`, { method: "DELETE" }).catch(() => undefined);
    }
    textareaRef.current?.focus();
  };

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

  const finishResize = useCallback(() => {
    const session = resizeSessionRef.current;
    if (!session) return;
    persistPanelWidth(session.currentWidth);
    resizeSessionRef.current = null;
    setIsResizing(false);
  }, [persistPanelWidth]);

  useEffect(() => {
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const session = resizeSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      const nextWidth = clampPanelWidth(session.startWidth + session.startX - event.clientX);
      session.currentWidth = nextWidth;
      setPanelWidth(nextWidth);
    };
    const handlePointerEnd = (event: globalThis.PointerEvent) => {
      if (resizeSessionRef.current?.pointerId === event.pointerId) finishResize();
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [clampPanelWidth, finishResize]);

  const handleResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.innerWidth <= MOBILE_BREAKPOINT) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeSessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: panelWidth,
      currentWidth: panelWidth,
    };
    setIsResizing(true);
  };

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextWidth = clampPanelWidth(panelWidth + (event.key === "ArrowLeft" ? 24 : -24));
    setPanelWidth(nextWidth);
    persistPanelWidth(nextWidth);
  };

  const historyMode = context.mode === "history";

  return (
    <div className={styles.widgetRoot}>
      {isOpen && (
        <section
          id="gekon-ai-panel"
          className={`${styles.panel}${isResizing ? ` ${styles.resizing}` : ""}`}
          style={{ width: panelWidth }}
          role="dialog"
          aria-labelledby="gekon-ai-title"
        >
          <div
            className={styles.resizeHandle}
            role="separator"
            aria-label="Gekon AI panel genişliğini ayarla"
            aria-orientation="vertical"
            aria-valuemin={MIN_PANEL_WIDTH}
            aria-valuenow={panelWidth}
            tabIndex={0}
            onKeyDown={handleResizeKeyDown}
            onPointerDown={handleResizeStart}
          />
          <header className={styles.header}>
            <div className={styles.titleBlock}>
              <span className={styles.botBadge} aria-hidden="true"><Bot size={16} /></span>
              <div>
                <h2 id="gekon-ai-title">Gekon AI</h2>
                <span className={`${styles.status} ${lastError ? styles.statusError : ""}`}>
                  <i aria-hidden="true" />
                  {lastError ? "Gekon AI bağlantısı kesildi" : "Gekon AI hazır"}
                </span>
              </div>
            </div>
            <button type="button" className={styles.iconButton} onClick={() => setIsOpen(false)} aria-label="Gekon AI panelini kapat" title="Kapat"><X size={16} /></button>
          </header>

          <div className={styles.messages} aria-live="polite">
            {messages.length === 0 && (
              <div className={styles.emptyState}>
                <Bot size={18} />
                <p>{historyMode
                  ? "Seçili varlığın gerçek rota geçmişi ve tarih aralığı hakkında soru sorun."
                  : "Seçili takip etiketinin canlı konumu, durumu ve bulunduğu alan hakkında soru sorun."}</p>
              </div>
            )}
            {messages.map((message) => (
              <article key={message.id} className={`${styles.messageRow} ${message.role === "user" ? styles.userRow : styles.assistantRow}`}>
                <span className={styles.avatar} aria-hidden="true">{message.role === "user" ? <User size={13} /> : <Bot size={13} />}</span>
                <p className={`${styles.bubble} ${message.isError ? styles.errorBubble : ""}`}>{message.role === "assistant" ? toDisplayText(message.content) : message.content}</p>
              </article>
            ))}
            {loading && (
              <div className={`${styles.messageRow} ${styles.assistantRow}`}>
                <span className={styles.avatar} aria-hidden="true"><Bot size={13} /></span>
                <p className={styles.typingBubble}><Loader2 size={14} className={styles.spin} /> Gekon AI analiz ediyor</p>
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
              placeholder={historyMode ? "Gekon AI ile gerçek konum geçmişini analiz et" : "Gekon AI’a canlı operasyonu sor"}
              rows={2}
              maxLength={1000}
              aria-label="Gekon AI'a mesaj yaz"
            />
            <div className={styles.actions}>
              <button type="button" className={styles.clearButton} onClick={clearConversation} disabled={loading || messages.length === 0}><Trash2 size={13} /> Konuşmayı temizle</button>
              <button type="submit" className={styles.sendButton} disabled={loading || input.trim().length === 0} aria-label="Mesaj gönder" title="Gönder">
                {loading ? <Loader2 size={16} className={styles.spin} /> : <SendHorizontal size={16} />}
              </button>
            </div>
          </form>
        </section>
      )}

      {!isOpen && (
        <div className={styles.launchCluster}>
          <span className={styles.launchLabel}>Gekon AI</span>
          <button type="button" className={styles.launchButton} onClick={() => setIsOpen(true)} aria-label="Gekon AI'ı aç" aria-expanded={false} title="Gekon AI">
            <MessageCircle size={22} />
          </button>
        </div>
      )}
    </div>
  );
}

export function HistoryChatWidget({
  tagCode,
  entityName,
  from,
  to,
  floorPlanId,
  draftText,
  draftRequestId,
  history,
  historyPoints,
}: HistoryChatWidgetProps) {
  const context = useMemo<GekonAiContext>(() => ({
    mode: "history",
    tagCode,
    entityName,
    from,
    to,
    floorPlanId,
    history,
    historyPoints,
  }), [entityName, floorPlanId, from, history, historyPoints, tagCode, to]);
  return <GekonAiWidget context={context} draftText={draftText} draftRequestId={draftRequestId} />;
}
