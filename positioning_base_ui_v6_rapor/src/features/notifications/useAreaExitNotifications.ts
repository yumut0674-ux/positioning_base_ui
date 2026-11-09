import { useCallback, useEffect, useRef, useState } from "react";
import type { AreaExitNotification } from "./notification.types";

const DISMISSED_KEY = "area-exit-notifications-dismissed-v1";
export function useAreaExitNotifications() {
  const [items, setItems] = useState<AreaExitNotification[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const dismissed = useRef<Record<string, number>>({});
  const visibleUntil = useRef<Record<string, number>>({});
  const serverOffset = useRef(0);
  useEffect(() => {
    try { dismissed.current = JSON.parse(window.sessionStorage.getItem(DISMISSED_KEY) ?? "{}"); } catch { /* Storage is optional. */ }
    let busy = false;
    const controller = new AbortController();
    const load = async () => {
      if (busy || controller.signal.aborted) return;
      busy = true;
      try {
        const response = await fetch("/api/notifications", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Bildirim bağlantısı yenileniyor.");
        const payload = await response.json() as { items: AreaExitNotification[]; serverNow: number; warning: string | null };
        if (controller.signal.aborted) return;
        serverOffset.current = payload.serverNow - Date.now();
        dismissed.current = Object.fromEntries(Object.entries(dismissed.current).filter(([, expires]) => expires > payload.serverNow));
        for (const item of payload.items) {
          // The configured duration starts when this browser first receives the toast.
          // Polling must neither shorten the visible duration nor restart it on every response.
          visibleUntil.current[item.id] ??= payload.serverNow + item.displayDurationMs;
        }
        setItems(current => [...new Map([...current, ...payload.items].map(item => [item.id, item])).values()]
          .filter(item => !dismissed.current[item.id] && visibleUntil.current[item.id] > payload.serverNow));
        setWarning(payload.warning);
      } catch { if (!controller.signal.aborted) setWarning("Bildirim bağlantısı yenileniyor."); }
      finally { busy = false; }
    };
    void load();
    const poll = window.setInterval(() => void load(), 500);
    const expiry = window.setInterval(() => {
      const now = Date.now() + serverOffset.current;
      setItems(current => current.some(item => visibleUntil.current[item.id] <= now)
        ? current.filter(item => visibleUntil.current[item.id] > now) : current);
    }, 100);
    return () => { controller.abort(); window.clearInterval(poll); window.clearInterval(expiry); };
  }, []);
  const dismiss = useCallback((item: AreaExitNotification) => {
    dismissed.current[item.id] = visibleUntil.current[item.id] ?? Date.parse(item.createdAt) + item.displayDurationMs;
    try { window.sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed.current)); } catch { /* Remains dismissed in memory. */ }
    setItems(current => current.filter(value => value.id !== item.id));
  }, []);
  return { items, warning, dismiss };
}
