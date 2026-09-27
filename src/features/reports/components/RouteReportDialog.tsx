"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, X } from "lucide-react";
import { fetchTags, type TagDefinition } from "@/src/features/tracking/services/tagApi";
import type { RouteReportRoom } from "@/src/server/reports/routeReportRooms";
import styles from "./routeReportDialog.module.css";

interface Props {
  readonly onClose: () => void;
  readonly initialTagCode?: string;
  readonly initialFrom?: string;
  readonly initialTo?: string;
}

function localIstanbul(date: Date): string { return new Date(date.getTime() + 3 * 3_600_000).toISOString().slice(0, 16); }
function initialRange() { const to = new Date(); return { from: localIstanbul(new Date(to.getTime() - 4 * 3_600_000)), to: localIstanbul(to) }; }
function iso(value: string): string { return new Date(`${value}:00+03:00`).toISOString(); }
function roomKey(room: RouteReportRoom): string { return JSON.stringify([room.mapId, room.roomId]); }

export function RouteReportDialog({ onClose, initialTagCode, initialFrom, initialTo }: Props) {
  const [range] = useState(initialRange);
  const [from, setFrom] = useState(initialFrom ?? range.from);
  const [to, setTo] = useState(initialTo ?? range.to);
  const [tags, setTags] = useState<TagDefinition[]>([]);
  const [selected, setSelected] = useState<string[]>(initialTagCode ? [initialTagCode.toUpperCase()] : []);
  const [tagState, setTagState] = useState<"loading" | "ready" | "error">("loading");
  const [rooms, setRooms] = useState<RouteReportRoom[]>([]);
  const [roomState, setRoomState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedRoomKey, setSelectedRoomKey] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !creating) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [creating, onClose]);
  useEffect(() => {
    let active = true;
    void fetchTags().then(value => { if (active) { setTags(value); setTagState("ready"); } })
      .catch(() => { if (active) setTagState("error"); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    void fetch("/api/reports/route-history", { headers: { Accept: "application/json" } })
      .then(async response => {
        if (!response.ok) throw new Error("Oda listesi yüklenemedi.");
        return response.json() as Promise<{ rooms: RouteReportRoom[] }>;
      })
      .then(value => { if (active) { setRooms(value.rooms); setRoomState("ready"); } })
      .catch(() => { if (active) setRoomState("error"); });
    return () => { active = false; };
  }, []);

  const toggle = (code: string) => {
    setMessage(null);
    setSelected(current => current.includes(code) ? current.filter(item => item !== code) : [...current, code]);
  };
  const create = async () => {
    setMessage(null);
    if (!selected.length) { setMessage("En az bir tag seçin."); return; }
    const start = Date.parse(`${from}:00+03:00`), end = Date.parse(`${to}:00+03:00`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) { setMessage("Başlangıç ve bitiş tarihlerini doğru sırayla seçin."); return; }
    if (end - start > 7 * 86_400_000) { setMessage("Tarih aralığı en fazla 7 gün olabilir."); return; }
    const room = selectedRoomKey ? rooms.find(item => roomKey(item) === selectedRoomKey) : undefined;
    if (selectedRoomKey && !room) { setMessage("Seçilen oda bulunamadı. Pencereyi yeniden açıp tekrar deneyin."); return; }
    setCreating(true);
    try {
      const response = await fetch("/api/reports/route-history", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/pdf" },
        body: JSON.stringify({ tags: selected, from: iso(from), to: iso(to), ...(room ? { room: { mapId: room.mapId, roomId: room.roomId } } : {}) }) });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error ?? "PDF raporu oluşturulamadı.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `rota-gecmisi-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      onClose();
    } catch (error) { setMessage(error instanceof Error ? error.message : "PDF raporu oluşturulamadı."); }
    finally { setCreating(false); }
  };

  return createPortal(<div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget && !creating) onClose(); }}>
    <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="route-report-title" aria-busy={creating}>
      <header className={styles.header}><div><small>PDF RAPORU</small><h2 id="route-report-title">Rota Geçmişi Raporu</h2></div><button ref={closeRef} type="button" aria-label="Pencereyi kapat" onClick={onClose} disabled={creating}><X size={18} /></button></header>
      <div className={styles.body}>
        <fieldset className={styles.tagField}><legend>Taglar</legend>
          {tagState === "loading" && <p role="status"><Loader2 size={15} className={styles.spin} /> Taglar yükleniyor…</p>}
          {tagState === "error" && <p role="alert">Tag listesi yüklenemedi. Pencereyi yeniden açıp tekrar deneyin.</p>}
          {tagState === "ready" && tags.length === 0 && <p>Seçilebilecek kayıtlı tag bulunamadı.</p>}
          {tagState === "ready" && tags.length > 0 && <div className={styles.tagList}>{tags.map(tag => <label key={tag.id}><input type="checkbox" checked={selected.includes(tag.id.toUpperCase())} onChange={() => toggle(tag.id.toUpperCase())} disabled={creating} /><span>{tag.displayName}</span><code>{tag.id}</code></label>)}</div>}
        </fieldset>
        <label className={styles.roomField}>Oda
          <select value={selectedRoomKey} onChange={event => { setSelectedRoomKey(event.target.value); setMessage(null); }} disabled={creating || roomState !== "ready"}>
            <option value="">Tüm odalar</option>
            {rooms.map(room => <option key={roomKey(room)} value={roomKey(room)}>{room.mapName} / {room.roomName}</option>)}
          </select>
        </label>
        {roomState === "loading" && <p className={styles.roomStatus} role="status">Odalar yükleniyor… Tüm odalar için rapor oluşturabilirsiniz.</p>}
        {roomState === "error" && <p className={styles.roomStatus} role="alert">Oda listesi yüklenemedi. Tüm odalar için rapor oluşturabilirsiniz.</p>}
        <div className={styles.dates}><label>Başlangıç<input type="datetime-local" value={from} onChange={event => { setFrom(event.target.value); setMessage(null); }} disabled={creating} /></label><label>Bitiş<input type="datetime-local" value={to} onChange={event => { setTo(event.target.value); setMessage(null); }} disabled={creating} /></label></div>
        <p className={styles.hint}>Rapor aralığı en fazla 7 gün olabilir. Veri bulunmayan süreler PDF içinde açıkça gösterilir.</p>
        {message && <p className={styles.message} role="alert">{message}</p>}
      </div>
      <footer className={styles.footer}><button type="button" onClick={onClose} disabled={creating}>İptal</button><button type="button" className={styles.primary} onClick={() => void create()} disabled={creating || tagState !== "ready" || tags.length === 0}>{creating ? <Loader2 size={16} className={styles.spin} /> : <Download size={16} />}{creating ? "PDF oluşturuluyor…" : "PDF Oluştur"}</button></footer>
    </section>
  </div>, document.body);
}
