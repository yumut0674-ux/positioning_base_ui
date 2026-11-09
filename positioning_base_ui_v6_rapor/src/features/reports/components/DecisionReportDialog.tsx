"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, X } from "lucide-react";
import { fetchTags, type TagDefinition } from "@/src/features/tracking/services/tagApi";
import { downloadAdminRouteReport } from "../services/adminRouteReportApi";
import type { DecisionReportFormat } from "../types/decisionReport.types";
import styles from "./routeReportDialog.module.css";

interface Props {
  readonly onClose: () => void;
  readonly initialFilters: { readonly from: string; readonly to: string; readonly tagCode: string; readonly mapId: string; readonly regionId: string };
}
export function DecisionReportDialog({ onClose, initialFilters }: Props) {
  const [from, setFrom] = useState(initialFilters.from);
  const [to, setTo] = useState(initialFilters.to);
  const [tagCode, setTagCode] = useState(initialFilters.tagCode);
  const [mapId, setMapId] = useState(initialFilters.mapId);
  const [regionId, setRegionId] = useState(initialFilters.regionId);
  const [format, setFormat] = useState<DecisionReportFormat>("pdf");
  const [tags, setTags] = useState<readonly TagDefinition[]>([]);
  const [tagError, setTagError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    void fetchTags().then(value => { if (active) setTags(value); }).catch(() => { if (active) setTagError(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !creating) onClose();
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
      if (!focusable?.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [creating, onClose]);

  const create = async () => {
    setMessage("");
    const start = Date.parse(`${from}:00+03:00`), end = Date.parse(`${to}:00+03:00`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) { setMessage("Başlangıç ve bitiş tarihlerini doğru sırayla seçin."); return; }
    if (end - start > 7 * 86_400_000) { setMessage("Tarih aralığı en fazla 7 gün olabilir."); return; }
    setCreating(true);
    try {
      await downloadAdminRouteReport({ from: new Date(start).toISOString(), to: new Date(end).toISOString(), format,
        ...(tagCode.trim() ? { tagCode: tagCode.trim() } : {}), ...(mapId.trim() ? { mapId: mapId.trim() } : {}), ...(regionId.trim() ? { regionId: regionId.trim() } : {}) });
      onClose();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Rapor oluşturulamadı."); }
    finally { setCreating(false); }
  };

  return createPortal(<div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget && !creating) onClose(); }}>
    <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="decision-report-title" aria-describedby="decision-report-scope" aria-busy={creating}>
      <header className={styles.header}><div><small>YÖNETİCİ RAPORU</small><h2 id="decision-report-title">Oda ve koridor raporu</h2></div><button ref={closeRef} type="button" aria-label="Pencereyi kapat" onClick={onClose} disabled={creating}><X size={18} /></button></header>
      <div className={styles.body}>
        <p id="decision-report-scope" className={styles.hint}>Oda ve koridorlar başlangıç, bitiş ve kalış süresiyle gösterilir. Kesintisiz aynı konum tek satırdır. Oda → koridor → aynı oda ayrı satırlarda kalır; minimum süre filtresi uygulanmaz.</p>
        <label className={styles.roomField}>Tag<select value={tagCode} onChange={event => setTagCode(event.target.value)} disabled={creating}>
          <option value="">Tüm taglar</option>
          {tagCode && !tags.some(tag => tag.id === tagCode) && <option value={tagCode}>Kod eşleşmesi: {tagCode}</option>}
          {tags.map(tag => <option key={tag.id} value={tag.id}>{tag.displayName} ({tag.id})</option>)}
        </select></label>
        {tagError && <p className={styles.hint}>Tag listesi yüklenemedi. Mevcut tag seçimiyle rapor oluşturabilirsiniz.</p>}
        <div className={styles.dates}><label>Başlangıç (TR)<input type="datetime-local" value={from} onChange={event => setFrom(event.target.value)} disabled={creating} /></label><label>Bitiş (TR)<input type="datetime-local" value={to} onChange={event => setTo(event.target.value)} disabled={creating} /></label></div>
        <div className={styles.dates}><label>Harita / kat ID<input value={mapId} placeholder="Tüm haritalar" onChange={event => setMapId(event.target.value)} disabled={creating} /></label><label>Oda ID<input value={regionId} placeholder="Tüm odalar" onChange={event => setRegionId(event.target.value)} disabled={creating} /></label></div>
        <label className={styles.roomField}>Çıktı biçimi<select value={format} onChange={event => setFormat(event.target.value as DecisionReportFormat)} disabled={creating}><option value="pdf">PDF · Oda ve koridor raporu</option><option value="xlsx">Excel · Oda ve koridor aralıkları</option><option value="csv">CSV · Oda ve koridor aralıkları</option><option value="json">JSON · Oda ve koridor aralıkları</option></select></label>
        <p className={styles.hint}>Kısa oda ve koridor aralıkları korunur. Ölçülen ve tahmini kararlar belirtilir; oda adayı doğrulanmış giriş sayılmaz. Belirsiz süreler oda veya koridor süresine eklenmez. Saatler Türkiye saatidir.</p>
        <p className={styles.hint}>En fazla 7 gün ve 50.000 kaynak kayıt; PDF için 5.000 konum aralığı. Sınır aşılırsa eksik dosya oluşturulmaz.</p>
        {message && <p className={styles.message} role="alert">{message}</p>}
      </div>
      <footer className={styles.footer}><button type="button" onClick={onClose} disabled={creating}>Vazgeç</button><button type="button" className={styles.primary} disabled={creating} onClick={() => void create()}>{creating ? <Loader2 size={15} className={styles.spin} /> : <Download size={15} />}{creating ? "Hazırlanıyor…" : "Raporu indir"}</button></footer>
    </section>
  </div>, document.body);
}
