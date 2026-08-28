"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Boxes, CheckCircle2, Loader2, Pencil, Plus, Search, ShieldCheck, Trash2, TriangleAlert, X } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import { deleteTag, saveTag, type TagDefinition } from "@/src/features/tracking/services/tagApi";
import { useRealtimeTracking } from "@/src/features/tracking/hooks/useRealtimeTracking";
import styles from "../anchors/anchors.module.css";

const EMPTY_TAG: TagDefinition = { id: "", displayName: "", status: "active" };
const REGISTRATION_STATUS_OPTIONS = ["active", "inactive"];
const LIVE_STATUS_OPTIONS = ["active", "offline"];

function statusLabel(status: string) { return status === "active" ? "Aktif" : "Pasif"; }
function statusClass(status: string) { return status === "active" ? "good" : "offline"; }
function Status({ status }: { readonly status: string }) { return <span className={`${styles.status} ${styles[statusClass(status)]}`}><i />{statusLabel(status)}</span>; }

export function TagManagementPanel({ embedded = false }: { readonly embedded?: boolean }) {
  const tagDefinitions = useIpsStore((state) => state.tagDefinitions);
  const trackedTags = useIpsStore((state) => state.tags);
  const observedTags = useIpsStore((state) => state.observedTags);
  const setTagDefinitions = useIpsStore((state) => state.setTagDefinitions);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState<TagDefinition>(EMPTY_TAG);
  const [isNew, setIsNew] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TagDefinition | null>(null);
  const [deleting, setDeleting] = useState(false);

  const registeredTags = useMemo(() => Object.values(tagDefinitions), [tagDefinitions]);
  const liveStatus = (tagId: string) => observedTags[tagId]?.status === "active" || trackedTags[tagId]?.status === "active" ? "active" : "offline";
  const visibleTags = registeredTags.filter((tag) => {
    const matchesSearch = `${tag.id} ${tag.displayName}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (filter === "all" || liveStatus(tag.id) === filter);
  });
  const unknownTags = useMemo(() => Object.values(observedTags).filter((tag) => {
    const matchesSearch = `${tag.id} ${tag.name}`.toLowerCase().includes(search.toLowerCase());
    return !tagDefinitions[tag.id] && matchesSearch && (filter === "all" || tag.status === filter);
  }), [filter, observedTags, search, tagDefinitions]);
  const activeCount = registeredTags.filter((tag) => liveStatus(tag.id) === "active").length;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.id.trim()) { setError("Takip etiketi kodu zorunludur."); return; }
    setSaving(true); setError("");
    try {
      setTagDefinitions(await saveTag({ ...form, id: form.id.trim() }, isNew));
      setFormOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Takip etiketi kaydedilemedi.");
    } finally { setSaving(false); }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true); setError("");
    try {
      setTagDefinitions(await deleteTag(deleteTarget.id));
      setDeleteTarget(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Takip etiketi silinemedi.");
    } finally { setDeleting(false); }
  }

  return <main className={`${styles.page} ${embedded ? styles.embedded : ""}`}>
    <section className={styles.content}>
      <header className={styles.header}>
        <div><div className={styles.eyebrow}><Boxes size={14} /> İZLENEN VARLIKLAR</div><h1>Takip Etiketi Yönetimi</h1><p>Kayıtlı takip etiketlerini, canlı bağlantı durumlarını ve bilinmeyen yayıncıları yönetin.</p></div>
        <div className={styles.headerActions}><button className={styles.primaryButton} type="button" onClick={() => { setForm(EMPTY_TAG); setIsNew(true); setFormOpen(true); }}><Plus size={17} /> Yeni Takip Etiketi Ekle</button></div>
      </header>

      <section className={styles.metrics} aria-label="Takip etiketi özeti">
        <div className={styles.metric}><span className={styles.metricIcon}><Boxes size={19} /></span><div><small>KAYITLI ETİKET</small><strong>{registeredTags.length}</strong><em>Veritabanı tanımı bulunan</em></div></div>
        <div className={styles.metric}><span className={`${styles.metricIcon} ${styles.goodIcon}`}><CheckCircle2 size={19} /></span><div><small>AKTİF</small><strong>{activeCount}</strong><em>Son 10 sn veri aldı</em></div></div>
        <div className={styles.metric}><span className={`${styles.metricIcon} ${styles.offlineIcon}`}><TriangleAlert size={19} /></span><div><small>PASİF</small><strong>{registeredTags.length - activeCount}</strong><em>Canlı veri bekleniyor</em></div></div>
        <div className={styles.metric}><span className={styles.metricIcon}><ShieldCheck size={19} /></span><div><small>KAYITSIZ</small><strong>{unknownTags.length}</strong><em>Yalnızca canlı akışta</em></div></div>
      </section>

      <section className={styles.tableCard}>
        <div className={styles.toolbar}><div className={styles.search}><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Takip etiketi kodu veya görünen isim ara…" aria-label="Takip etiketi ara" /></div><label className={styles.filter}><span>Canlı durum</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Tümü</option>{LIVE_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label></div>
        {error && <div className={styles.error}><TriangleAlert size={16} /> {error}</div>}
        <div className={styles.tableWrap}><table><thead><tr><th>Takip Etiketi</th><th>Görünen İsim</th><th>Canlı Durum</th><th aria-label="İşlemler" /></tr></thead><tbody>
          {visibleTags.map((tag, index) => <motion.tr key={tag.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * .035, .2) }}><td><div className={styles.anchorIdentity}><span><Boxes size={16} /></span><div><code>{tag.id}</code><strong>Donanım kimliği</strong></div></div></td><td><strong>{tag.displayName || "İsimsiz takip etiketi"}</strong></td><td><Status status={liveStatus(tag.id)} /></td><td><div className={styles.rowActions}><button type="button" title="Düzenle" onClick={() => { setForm({ ...tag }); setIsNew(false); setFormOpen(true); }}><Pencil size={16} /></button><button type="button" className={styles.deleteButton} title="Sil" onClick={() => setDeleteTarget(tag)}><Trash2 size={16} /></button></div></td></motion.tr>)}
          {unknownTags.map((tag) => <motion.tr className={styles.unregisteredRow} key={tag.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><td><div className={styles.anchorIdentity}><span><Boxes size={16} /></span><div><code>{tag.id}</code><strong>Donanım kimliği</strong></div></div></td><td><strong className={styles.unregisteredName}>Kayıtlı değil</strong></td><td><Status status={tag.status} /></td><td><div className={styles.rowActions}><button type="button" className={styles.registerButton} onClick={() => { setForm({ id: tag.id, displayName: "", status: "active" }); setIsNew(true); setFormOpen(true); }}>Kaydet</button></div></td></motion.tr>)}
          {visibleTags.length + unknownTags.length === 0 && <tr><td colSpan={4}><div className={styles.empty}><Search size={22} /> Eşleşen takip etiketi bulunamadı.</div></td></tr>}
        </tbody></table></div>
        <footer className={styles.tableFooter}><span><Boxes size={14} /> {visibleTags.length} kayıtlı, {unknownTags.length} kayıt dışı takip etiketi gösteriliyor</span><span>Canlı durumlar canlı konum akışından alınır</span></footer>
      </section>
    </section>

    <AnimatePresence>{formOpen && <><motion.button type="button" className={styles.backdrop} aria-label="Formu kapat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setFormOpen(false)} /><motion.aside className={styles.drawer} initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 310, damping: 31 }}><div className={styles.drawerHeader}><div><span>{isNew ? "YENİ KAYIT" : "TAKİP ETİKETİNİ DÜZENLE"}</span><h2>{isNew ? "Yeni Takip Etiketi Ekle" : form.id}</h2></div><button type="button" onClick={() => setFormOpen(false)} aria-label="Kapat"><X size={20} /></button></div><form className={styles.form} onSubmit={submit}><section><h3><Boxes size={16} /> Takip Etiketi Bilgileri</h3><div className={styles.fieldGrid}><label className={styles.field}><span>Takip etiketi kodu *</span><input value={form.id} disabled={!isNew} onChange={(event) => setForm({ ...form, id: event.target.value })} placeholder="Örn. TAG-031" required />{!isNew && <small>Takip etiketi kodu değiştirilemez.</small>}</label><label className={styles.field}><span>Görünen isim</span><input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="Örn. Forklift A" /></label><label className={styles.field}><span>Kayıt durumu</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{REGISTRATION_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label></div></section><div className={styles.formFooter}><button type="button" className={styles.ghostButton} onClick={() => setFormOpen(false)}>Vazgeç</button><button className={styles.primaryButton} disabled={saving}>{saving ? <Loader2 size={16} className={styles.spin} /> : <ShieldCheck size={16} />}{saving ? "Kaydediliyor" : "Takip Etiketini Kaydet"}</button></div></form></motion.aside></>}</AnimatePresence>
    {typeof document !== "undefined" && createPortal(<AnimatePresence>{deleteTarget && <><motion.button type="button" className={styles.backdrop} aria-label="Silme penceresini kapat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeleteTarget(null)} /><motion.section className={styles.deleteModal} role="dialog" aria-modal="true" initial={{ opacity: 0, scale: .96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .96, y: 12 }}><span className={styles.dangerIcon}><TriangleAlert size={25} /></span><h2>{deleteTarget.id} silinsin mi?</h2><p>Takip etiketi kaydı kalıcı olarak silinecek. Bu işlem geri alınamaz.</p><div><button type="button" className={styles.ghostButton} onClick={() => setDeleteTarget(null)}>Vazgeç</button><button type="button" className={styles.dangerButton} disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? <Loader2 size={16} className={styles.spin} /> : <Trash2 size={16} />} Kalıcı Olarak Sil</button></div></motion.section></>}</AnimatePresence>, document.body)}
  </main>;
}

export default function TagsPage() {
  useRealtimeTracking();
  return <TagManagementPanel />;
}
