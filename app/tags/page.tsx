"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Boxes, CheckCircle2, Loader2, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, TriangleAlert, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { deleteTag, fetchTags, saveTag, type TagDefinition } from "@/src/features/tracking/services/tagApi";
import styles from "../anchors/anchors.module.css";

const EMPTY_TAG: TagDefinition = { id: "", displayName: "", status: "active" };
const STATUS_OPTIONS = ["active", "inactive"];

function statusLabel(status: string) { return status === "active" ? "Aktif" : "Pasif"; }
function statusClass(status: string) { return status === "active" ? "good" : "offline"; }
function Status({ status }: { status: string }) { return <span className={`${styles.status} ${styles[statusClass(status)]}`}><i />{statusLabel(status)}</span>; }

export function TagManagementPanel({ embedded = false }: { readonly embedded?: boolean }) {
  const [tags, setTags] = useState<TagDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState<TagDefinition>(EMPTY_TAG);
  const [isNew, setIsNew] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TagDefinition | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function reload(showSpinner = false) {
    if (showSpinner) setRefreshing(true); else setLoading(true);
    setError("");
    try { setTags(await fetchTags()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Tag listesi alınamadı."); }
    finally { if (showSpinner) setRefreshing(false); else setLoading(false); }
  }

  useEffect(() => { void fetchTags().then(setTags).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Tag listesi alınamadı.")).finally(() => setLoading(false)); }, []);

  const visibleTags = useMemo(() => tags.filter((tag) => `${tag.id} ${tag.displayName}`.toLowerCase().includes(search.toLowerCase()) && (filter === "all" || tag.status === filter)), [tags, search, filter]);
  const activeCount = tags.filter((tag) => tag.status === "active").length;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.id.trim()) { setError("Tag ID zorunludur."); return; }
    setSaving(true); setError("");
    try { setTags(await saveTag({ ...form, id: form.id.trim() }, isNew)); setFormOpen(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Tag kaydedilemedi."); }
    finally { setSaving(false); }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true); setError("");
    try { setTags(await deleteTag(deleteTarget.id)); setDeleteTarget(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Tag silinemedi."); }
    finally { setDeleting(false); }
  }

  return <main className={`${styles.page} ${embedded ? styles.embedded : ""}`}>
    <section className={styles.content}>
      <header className={styles.header}>
        <div><div className={styles.eyebrow}><Boxes size={14} /> VARLIK YÖNETİMİ</div><h1>Tracked Assets</h1><p>Tag isimlerini ve aktiflik durumlarını yönetin.</p></div>
        <div className={styles.headerActions}><button className={styles.ghostButton} type="button" onClick={() => void reload(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing ? styles.spin : ""} /> Yenile</button><button className={styles.primaryButton} type="button" onClick={() => { setForm(EMPTY_TAG); setIsNew(true); setFormOpen(true); }}><Plus size={17} /> Yeni Tag Ekle</button></div>
      </header>
      <section className={styles.metrics} aria-label="Tag özeti">
        <div className={styles.metric}><span className={styles.metricIcon}><Boxes size={19} /></span><div><small>TOPLAM TAG</small><strong>{tags.length}</strong><em>Tanımlı varlık</em></div></div>
        <div className={styles.metric}><span className={`${styles.metricIcon} ${styles.goodIcon}`}><CheckCircle2 size={19} /></span><div><small>AKTİF</small><strong>{activeCount}</strong><em>İzlemeye açık</em></div></div>
        <div className={styles.metric}><span className={`${styles.metricIcon} ${styles.offlineIcon}`}><TriangleAlert size={19} /></span><div><small>PASİF</small><strong>{tags.length - activeCount}</strong><em>İzleme kapalı</em></div></div>
        <div className={styles.metric}><span className={styles.metricIcon}><ShieldCheck size={19} /></span><div><small>İSİMLENDİRİLMİŞ</small><strong>{tags.filter((tag) => tag.displayName && tag.displayName !== tag.id).length}</strong><em>Görünen isim</em></div></div>
      </section>
      <section className={styles.tableCard}>
        <div className={styles.toolbar}><div className={styles.search}><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tag ID veya görünen isim ara…" aria-label="Tag ara" /></div><label className={styles.filter}><span>Durum</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Tümü</option>{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label></div>
        {error && <div className={styles.error}><TriangleAlert size={16} /> {error}</div>}
        <div className={styles.tableWrap}><table><thead><tr><th>Tag</th><th>Görünen İsim</th><th>Durum</th><th aria-label="İşlemler" /></tr></thead><tbody>
          {loading && <tr><td colSpan={4}><div className={styles.empty}><Loader2 className={styles.spin} size={21} /> Tag kayıtları yükleniyor…</div></td></tr>}
          {!loading && visibleTags.map((tag, index) => <motion.tr key={tag.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * .035, .2) }}><td><div className={styles.anchorIdentity}><span><Boxes size={16} /></span><div><code>{tag.id}</code><strong>Donanım kimliği</strong></div></div></td><td><strong>{tag.displayName || "İsimsiz Tag"}</strong></td><td><Status status={tag.status} /></td><td><div className={styles.rowActions}><button type="button" title="Düzenle" onClick={() => { setForm({ ...tag }); setIsNew(false); setFormOpen(true); }}><Pencil size={16} /></button><button type="button" className={styles.deleteButton} title="Sil" onClick={() => setDeleteTarget(tag)}><Trash2 size={16} /></button></div></td></motion.tr>)}
          {!loading && visibleTags.length === 0 && <tr><td colSpan={4}><div className={styles.empty}><Search size={22} /> Eşleşen tag bulunamadı.</div></td></tr>}
        </tbody></table></div>
        <footer className={styles.tableFooter}><span><Boxes size={14} /> {visibleTags.length} / {tags.length} tag gösteriliyor</span><span>Veriler sayfa açılırken veya manuel yenilemede alınır</span></footer>
      </section>
    </section>
    <AnimatePresence>{formOpen && <><motion.button type="button" className={styles.backdrop} aria-label="Formu kapat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setFormOpen(false)} /><motion.aside className={styles.drawer} initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 310, damping: 31 }}><div className={styles.drawerHeader}><div><span>{isNew ? "YENİ KAYIT" : "TAG DÜZENLE"}</span><h2>{isNew ? "Yeni Tag Ekle" : form.id}</h2></div><button type="button" onClick={() => setFormOpen(false)} aria-label="Kapat"><X size={20} /></button></div><form className={styles.form} onSubmit={submit}><section><h3><Boxes size={16} /> Tag Bilgileri</h3><div className={styles.fieldGrid}><label className={styles.field}><span>Tag ID *</span><input value={form.id} disabled={!isNew} onChange={(event) => setForm({ ...form, id: event.target.value })} placeholder="Örn. TAG-031" required />{!isNew && <small>Tag kimliği değiştirilemez.</small>}</label><label className={styles.field}><span>Görünen isim</span><input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="Örn. Forklift A" /></label><label className={styles.field}><span>Durum</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label></div></section><div className={styles.formFooter}><button type="button" className={styles.ghostButton} onClick={() => setFormOpen(false)}>Vazgeç</button><button className={styles.primaryButton} disabled={saving}>{saving ? <Loader2 size={16} className={styles.spin} /> : <ShieldCheck size={16} />}{saving ? "Kaydediliyor" : "Tag Kaydet"}</button></div></form></motion.aside></>}</AnimatePresence>
    {typeof document !== "undefined" && createPortal(<AnimatePresence>{deleteTarget && <><motion.button type="button" className={styles.backdrop} aria-label="Silme penceresini kapat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeleteTarget(null)} /><motion.section className={styles.deleteModal} role="dialog" aria-modal="true" initial={{ opacity: 0, scale: .96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .96, y: 12 }}><span className={styles.dangerIcon}><TriangleAlert size={25} /></span><h2>{deleteTarget.id} silinsin mi?</h2><p>Tag kaydı kalıcı olarak silinecek. Bu işlem geri alınamaz.</p><div><button type="button" className={styles.ghostButton} onClick={() => setDeleteTarget(null)}>Vazgeç</button><button type="button" className={styles.dangerButton} disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? <Loader2 size={16} className={styles.spin} /> : <Trash2 size={16} />} Kalıcı Olarak Sil</button></div></motion.section></>}</AnimatePresence>, document.body)}
  </main>;
}

export default function TagsPage() { return <TagManagementPanel />; }
