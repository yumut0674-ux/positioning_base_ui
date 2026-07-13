"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, Clock3, FileText, Layers3, Loader2, MapPin, Pencil,
  Plus, RadioTower, RefreshCw, Search, ShieldCheck, Trash2, TriangleAlert, Wifi, WifiOff, X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AnchorDefinition } from "@/src/features/map/types/map.types";
import {
  deleteAnchor, fetchAnchorHealthLogs, fetchAnchors, saveAnchor,
  type AnchorHealthLog,
} from "@/src/features/map/services/anchorApi";
import styles from "./anchors.module.css";

const EMPTY_ANCHOR: AnchorDefinition = {
  id: "", name: "", x: 0, y: 0, z: null, status: "active", note: "", floorLevel: null, locationDesc: "",
};

const STATUS_OPTIONS = ["active", "online", "offline", "error", "low_battery"];

function statusKind(status = "active") {
  const normalized = status.toLowerCase();
  if (normalized === "active" || normalized === "online") return "good";
  if (normalized === "offline") return "offline";
  return "attention";
}

function statusLabel(status = "active") {
  return ({ active: "Aktif", online: "Çevrimiçi", offline: "Çevrimdışı", error: "Hata", low_battery: "Düşük Pil" } as Record<string, string>)[status.toLowerCase()] ?? status;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Tarih bilgisi yok" : new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function numberValue(value: string) { return value === "" ? null : Number(value); }

function StatusBadge({ status }: { status?: string }) {
  const kind = statusKind(status);
  return <span className={`${styles.status} ${styles[kind]}`}><i />{statusLabel(status)}</span>;
}

export function AnchorManagementPanel({ embedded = false }: { readonly embedded?: boolean }) {
  const [anchors, setAnchors] = useState<AnchorDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [form, setForm] = useState<AnchorDefinition>(EMPTY_ANCHOR);
  const [isNew, setIsNew] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AnchorDefinition | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [logsAnchor, setLogsAnchor] = useState<AnchorDefinition | null>(null);
  const [logs, setLogs] = useState<AnchorHealthLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");

  async function reload(showSpinner = false) {
    if (showSpinner) setIsRefreshing(true);
    else setIsLoading(true);
    setError("");
    try { setAnchors(await fetchAnchors()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Anchor listesi alınamadı."); }
    finally {
      if (showSpinner) setIsRefreshing(false);
      else setIsLoading(false);
    }
  }

  useEffect(() => {
    void fetchAnchors()
      .then(setAnchors)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Anchor listesi alınamadı."))
      .finally(() => setIsLoading(false));
  }, []);

  const filteredAnchors = useMemo(() => anchors.filter((anchor) => {
    const text = `${anchor.id} ${anchor.name ?? ""} ${anchor.locationDesc ?? ""}`.toLowerCase();
    return text.includes(search.toLowerCase()) && (statusFilter === "all" || anchor.status === statusFilter);
  }), [anchors, search, statusFilter]);

  const summary = useMemo(() => ({
    total: anchors.length,
    online: anchors.filter((anchor) => statusKind(anchor.status) === "good").length,
    offline: anchors.filter((anchor) => statusKind(anchor.status) === "offline").length,
    attention: anchors.filter((anchor) => statusKind(anchor.status) === "attention").length,
  }), [anchors]);

  function openNewForm() { setForm(EMPTY_ANCHOR); setIsNew(true); setIsFormOpen(true); }
  function openEditForm(anchor: AnchorDefinition) { setForm({ ...anchor }); setIsNew(false); setIsFormOpen(true); }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.id.trim() || !Number.isFinite(form.x) || !Number.isFinite(form.y)) {
      setError("Anchor ID, X ve Y alanlarını geçerli şekilde doldurun.");
      return;
    }
    setIsSaving(true); setError("");
    try {
      setAnchors(await saveAnchor({ ...form, id: form.id.trim() }, isNew));
      setIsFormOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Anchor kaydedilemedi."); }
    finally { setIsSaving(false); }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true); setError("");
    try { setAnchors(await deleteAnchor(deleteTarget.id)); setDeleteTarget(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Anchor silinemedi."); }
    finally { setIsDeleting(false); }
  }

  async function openLogs(anchor: AnchorDefinition) {
    setLogsAnchor(anchor); setLogs([]); setLogsError(""); setLogsLoading(true);
    try { setLogs(await fetchAnchorHealthLogs(anchor.id)); }
    catch (cause) { setLogsError(cause instanceof Error ? cause.message : "Sağlık kayıtları alınamadı."); }
    finally { setLogsLoading(false); }
  }

  return (
    <main className={`${styles.page} ${embedded ? styles.embedded : ""}`}>
      <div className={styles.aurora} />
      <section className={styles.content}>
        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}><RadioTower size={14} /> UWB ALTYAPI YÖNETİMİ</div>
            <h1>Anchor Yönetimi</h1>
            <p>Konum altyapınızı, koordinatları ve sağlık geçmişini tek ekrandan yönetin.</p>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.ghostButton} type="button" onClick={() => void reload(true)} disabled={isRefreshing}>
              <RefreshCw size={16} className={isRefreshing ? styles.spin : ""} /> Yenile
            </button>
            <button className={styles.primaryButton} type="button" onClick={openNewForm}><Plus size={17} /> Yeni Anchor Ekle</button>
          </div>
        </header>

        <section className={styles.metrics} aria-label="Anchor özeti">
          <div className={styles.metric}><span className={styles.metricIcon}><RadioTower size={19} /></span><div><small>TOPLAM ANCHOR</small><strong>{summary.total}</strong><em>Sistemde tanımlı</em></div></div>
          <div className={styles.metric}><span className={`${styles.metricIcon} ${styles.goodIcon}`}><Wifi size={19} /></span><div><small>ÇEVRİMİÇİ</small><strong>{summary.online}</strong><em>Sağlıklı bağlantı</em></div></div>
          <div className={styles.metric}><span className={`${styles.metricIcon} ${styles.offlineIcon}`}><WifiOff size={19} /></span><div><small>ÇEVRİMDIŞI</small><strong>{summary.offline}</strong><em>Kontrol gerekli</em></div></div>
          <div className={styles.metric}><span className={`${styles.metricIcon} ${styles.warnIcon}`}><TriangleAlert size={19} /></span><div><small>DİKKAT GEREKTİREN</small><strong>{summary.attention}</strong><em>Hata veya düşük pil</em></div></div>
        </section>

        <section className={styles.tableCard}>
          <div className={styles.toolbar}>
            <div className={styles.search}><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Anchor ID, isim veya konum ara…" aria-label="Anchor ara" /></div>
            <label className={styles.filter}><span>Durum</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Tümü</option>{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
          </div>
          {error && <div className={styles.error}><TriangleAlert size={16} /> {error}</div>}
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>Anchor</th><th>Kat & Konum</th><th>Koordinatlar</th><th>Durum</th><th aria-label="İşlemler" /></tr></thead>
              <tbody>
                {isLoading && <tr><td colSpan={5}><div className={styles.empty}><Loader2 className={styles.spin} size={21} /> Anchor kayıtları yükleniyor…</div></td></tr>}
                {!isLoading && filteredAnchors.map((anchor, index) => (
                  <motion.tr key={anchor.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.035, 0.22) }}>
                    <td><div className={styles.anchorIdentity}><span><RadioTower size={16} /></span><div><code>{anchor.id}</code><strong>{anchor.name || "İsimsiz Anchor"}</strong></div></div></td>
                    <td><div className={styles.location}><MapPin size={15} /><div><strong>{anchor.floorLevel === null || anchor.floorLevel === undefined ? "Kat belirtilmedi" : `${anchor.floorLevel}. kat`}</strong><span>{anchor.locationDesc || "Konum açıklaması yok"}</span></div></div></td>
                    <td><div className={styles.coordinates}><span>X <b>{anchor.x.toFixed(2)}</b></span><span>Y <b>{anchor.y.toFixed(2)}</b></span><span>Z <b>{anchor.z == null ? "—" : anchor.z.toFixed(2)}</b></span></div></td>
                    <td><StatusBadge status={anchor.status} /></td>
                    <td><div className={styles.rowActions}><button type="button" onClick={() => void openLogs(anchor)} title="Sağlık loglarını görüntüle"><Activity size={16} /></button><button type="button" onClick={() => openEditForm(anchor)} title="Düzenle"><Pencil size={16} /></button><button type="button" className={styles.deleteButton} onClick={() => setDeleteTarget(anchor)} title="Sil"><Trash2 size={16} /></button></div></td>
                  </motion.tr>
                ))}
                {!isLoading && filteredAnchors.length === 0 && <tr><td colSpan={5}><div className={styles.empty}><Search size={22} /> Eşleşen anchor bulunamadı.</div></td></tr>}
              </tbody>
            </table>
          </div>
          <footer className={styles.tableFooter}><span><Layers3 size={14} /> {filteredAnchors.length} / {anchors.length} anchor gösteriliyor</span><span>Son kontrol: sayfa yüklenirken veya manuel yenilemede</span></footer>
        </section>
      </section>

      <AnimatePresence>
        {isFormOpen && <><motion.button type="button" aria-label="Formu kapat" className={styles.backdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsFormOpen(false)} /><motion.aside className={styles.drawer} initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 310, damping: 31 }}>
          <div className={styles.drawerHeader}><div><span>{isNew ? "YENİ KAYIT" : "ANCHOR DÜZENLE"}</span><h2>{isNew ? "Yeni Anchor Ekle" : form.id}</h2></div><button type="button" onClick={() => setIsFormOpen(false)} aria-label="Kapat"><X size={20} /></button></div>
          <form className={styles.form} onSubmit={submitForm}>
            <section><h3><RadioTower size={16} /> Temel Bilgiler</h3><div className={styles.fieldGrid}><label className={styles.field}><span>Anchor ID *</span><input value={form.id} disabled={!isNew} onChange={(event) => setForm({ ...form, id: event.target.value })} placeholder="Örn. A-07" required />{!isNew && <small>Kimlik değiştirilemez; yeni anchor oluşturun.</small>}</label><label className={styles.field}><span>Anchor adı</span><input value={form.name ?? ""} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Örn. Depo kuzey" /></label><label className={styles.field}><span>Durum</span><select value={form.status ?? "active"} onChange={(event) => setForm({ ...form, status: event.target.value })}>{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label></div></section>
            <section><h3><MapPin size={16} /> Konum</h3><div className={styles.fieldGrid}><label className={styles.field}><span>X koordinatı *</span><input type="number" step="any" value={form.x} onChange={(event) => setForm({ ...form, x: Number(event.target.value) })} required /></label><label className={styles.field}><span>Y koordinatı *</span><input type="number" step="any" value={form.y} onChange={(event) => setForm({ ...form, y: Number(event.target.value) })} required /></label><label className={styles.field}><span>Z koordinatı</span><input type="number" step="any" value={form.z ?? ""} onChange={(event) => setForm({ ...form, z: numberValue(event.target.value) })} /></label><label className={styles.field}><span>Kat</span><input type="number" step="1" value={form.floorLevel ?? ""} onChange={(event) => setForm({ ...form, floorLevel: numberValue(event.target.value) })} /></label><label className={`${styles.field} ${styles.fullField}`}><span>Konum açıklaması</span><input value={form.locationDesc ?? ""} onChange={(event) => setForm({ ...form, locationDesc: event.target.value })} placeholder="Örn. A Blok giriş kapısı üzeri" /></label></div></section>
            <section><h3><FileText size={16} /> Notlar</h3><label className={styles.field}><span>Operasyon notu</span><textarea value={form.note ?? ""} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Bakım, montaj veya erişim notları…" rows={5} /></label></section>
            <div className={styles.formFooter}><button type="button" className={styles.ghostButton} onClick={() => setIsFormOpen(false)}>Vazgeç</button><button className={styles.primaryButton} disabled={isSaving}>{isSaving ? <Loader2 size={16} className={styles.spin} /> : <ShieldCheck size={16} />}{isSaving ? "Kaydediliyor" : "Anchor Kaydet"}</button></div>
          </form>
        </motion.aside></>}
      </AnimatePresence>

      <AnimatePresence>
        {logsAnchor && <><motion.button type="button" aria-label="Log panelini kapat" className={styles.backdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setLogsAnchor(null)} /><motion.aside className={styles.drawer} initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 310, damping: 31 }}>
          <div className={styles.drawerHeader}><div><span>SAĞLIK GEÇMİŞİ</span><h2>{logsAnchor.id}</h2></div><button type="button" onClick={() => setLogsAnchor(null)} aria-label="Kapat"><X size={20} /></button></div>
          <div className={styles.logIntro}><StatusBadge status={logsAnchor.status} /><p>Bu liste dış sağlık servisi tarafından yazılan, en yeni kaydın üstte olduğu geçmişi gösterir.</p></div>
          <div className={styles.timeline}>{logsLoading && <div className={styles.empty}><Loader2 className={styles.spin} size={21} /> Kayıtlar yükleniyor…</div>}{logsError && <div className={styles.error}><TriangleAlert size={16} /> {logsError}</div>}{!logsLoading && !logsError && logs.length === 0 && <div className={styles.empty}><Clock3 size={22} /> Henüz sağlık kaydı yok.</div>}{logs.map((log) => <article className={`${styles.logItem} ${styles[statusKind(log.status)]}`} key={log.id}><span className={styles.logDot} /><div className={styles.logBody}><div><StatusBadge status={log.status} /><time>{formatDate(log.createdAt)}</time></div><p>{log.message || "Detay mesajı iletilmedi."}</p></div></article>)}</div>
        </motion.aside></>}
      </AnimatePresence>

      <AnimatePresence>
        {deleteTarget && <><motion.button type="button" aria-label="Silme penceresini kapat" className={styles.backdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeleteTarget(null)} /><motion.section className={styles.deleteModal} role="dialog" aria-modal="true" aria-labelledby="delete-title" initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }}><span className={styles.dangerIcon}><TriangleAlert size={25} /></span><h2 id="delete-title">{deleteTarget.id} silinsin mi?</h2><p>Anchor ve ona bağlı tüm sağlık logları kalıcı olarak silinecek. Bu işlem geri alınamaz.</p><div><button type="button" className={styles.ghostButton} onClick={() => setDeleteTarget(null)}>Vazgeç</button><button type="button" className={styles.dangerButton} disabled={isDeleting} onClick={() => void confirmDelete()}>{isDeleting ? <Loader2 size={16} className={styles.spin} /> : <Trash2 size={16} />} Kalıcı Olarak Sil</button></div></motion.section></>}
      </AnimatePresence>
    </main>
  );
}

export default function AnchorsPage() {
  return <AnchorManagementPanel />;
}
