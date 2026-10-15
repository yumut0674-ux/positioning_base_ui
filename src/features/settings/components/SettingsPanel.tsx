"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock3, FileText, Info, Loader2, Radio, RotateCcw, Save, Settings2, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { fetchSystemSettings, normalizeSystemSettingsResponse, saveSystemSettings } from "../services/settingsApi";
import type { SystemSettings, SystemSettingsResponse } from "../types/settings.types";
import styles from "./settings.module.css";

type SettingsEditorProps = {
  readonly settings: SystemSettings;
  readonly saving: boolean;
  readonly onSave: (settings: SystemSettings) => Promise<void>;
};

// New categories add an editor here and their own group in the settings schema.
export const SETTINGS_CATEGORIES = [
  { id: "tracking", title: "Takip ve konum", description: "Tagların canlı haritadaki davranışı", icon: Radio, Editor: TrackingSettingsEditor },
  { id: "reports", title: "Raporlar", description: "Rota geçmişi PDF raporları", icon: FileText, Editor: ReportSettingsEditor },
] as const;

export function TrackingSettingsEditor({ settings, saving, onSave }: SettingsEditorProps) {
  const savedSeconds = settings.tracking.noDataHideAfterMs / 1_000;
  const [seconds, setSeconds] = useState(String(savedSeconds));
  const [error, setError] = useState("");
  const value = Number(seconds);
  const valid = seconds.trim() !== "" && Number.isInteger(value) && value >= 1 && value <= 86_400;
  const dirty = value !== savedSeconds || !valid;
  const duration = valid && value % 60 === 0 ? `${value / 60} dakika` : `${seconds || "—"} saniye`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) { setError("1 ile 86400 arasında tam saniye girin."); return; }
    setError("");
    try { await onSave({ ...settings, tracking: { ...settings.tracking, noDataHideAfterMs: value * 1_000 } }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Ayar kaydedilemedi."); }
  }

  return <form className={styles.card} onSubmit={submit} aria-labelledby="tracking-settings-title">
    <div className={styles.cardHeading}><span className={styles.cardIcon}><Clock3 size={21} /></span><div><h3 id="tracking-settings-title">Veri gelmeyen taglar</h3><p>Eski konumların canlı haritada kalma süresini yönetin.</p></div></div>
    <div className={styles.editorGrid}>
      <div className={styles.fieldGroup}>
        <label className={styles.field} htmlFor="no-data-hide-seconds"><span>Haritadan gizleme süresi</span><div className={styles.numberField}><input id="no-data-hide-seconds" type="number" inputMode="numeric" min="1" max="86400" step="1" value={seconds} disabled={saving} aria-describedby="no-data-hide-help" onChange={event => { setSeconds(event.target.value); setError(""); }} /><span>saniye</span></div></label>
        <p id="no-data-hide-help" className={styles.help}>Bu süre aşılırsa ve motorun geçerli bir oda kararı yoksa tag haritadan gizlenir. Etiket kaydı ve geçmişi korunur.</p>
        <div className={styles.presets} aria-label="Önerilen süreler">{[30, 60, 120, 300].map(preset => <button key={preset} type="button" disabled={saving} aria-pressed={value === preset} onClick={() => setSeconds(String(preset))}>{preset < 60 ? `${preset} sn` : `${preset / 60} dk`}</button>)}</div>
        <div className={styles.rule}><ShieldCheck size={17} /><p>Geçerli oda tahmini olan taglar motorun kararına göre gösterilmeye devam eder.</p></div>
      </div>
      <aside className={styles.preview} aria-label="Ayarın etkisi"><small>BU AYAR NASIL ÇALIŞIR?</small><div className={styles.timeline}><span><i />Son veri alındı</span><div><Clock3 size={14} /><strong>{duration}</strong><span>veri gelmezse</span></div><span><i />Oda kararı yoksa haritada gizli</span></div><div className={styles.example}><span>ETİKET LİSTESİNDE</span><strong>Son görüldüğü yer</strong><p>1. Kat · Oda 103</p><em>Güvenilir değil</em></div></aside>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <footer className={styles.cardFooter}><span><Info size={15} />Tüm katlar ve kullanıcılar için geçerlidir.</span><div><button type="button" className={styles.secondary} disabled={!dirty || saving} onClick={() => { setSeconds(String(savedSeconds)); setError(""); }}><RotateCcw size={14} />Değişiklikleri geri al</button><button type="submit" className={styles.primary} disabled={!dirty || !valid || saving}>{saving ? <Loader2 size={15} className={styles.spin} /> : <Save size={15} />}{saving ? "Kaydediliyor…" : "Değişiklikleri kaydet"}</button></div></footer>
  </form>;
}

export function ReportSettingsEditor({ settings, saving, onSave }: SettingsEditorProps) {
  const savedSeconds = settings.reports.routeHistoryMinDurationMs / 1_000;
  const [seconds, setSeconds] = useState(String(savedSeconds));
  const [error, setError] = useState("");
  const value = Number(seconds);
  const valid = seconds.trim() !== "" && Number.isInteger(value) && value >= 0 && value <= 86_400;
  const dirty = value !== savedSeconds || !valid;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) { setError("0 ile 86400 arasında tam saniye girin."); return; }
    setError("");
    try { await onSave({ ...settings, reports: { ...settings.reports, routeHistoryMinDurationMs: value * 1_000 } }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Ayar kaydedilemedi."); }
  }

  return <form className={styles.card} onSubmit={submit} aria-labelledby="report-settings-title">
    <div className={styles.cardHeading}><span className={styles.cardIcon}><FileText size={21} /></span><div><h3 id="report-settings-title">Rota geçmişi raporu</h3><p>PDF raporunda gösterilecek kayıtların en kısa süresini belirleyin.</p></div></div>
    <div className={styles.editorGrid}>
      <div className={styles.fieldGroup}>
        <label className={styles.field} htmlFor="route-report-min-seconds"><span>Rapora dahil edilecek en kısa süre</span><div className={styles.numberField}><input id="route-report-min-seconds" type="number" inputMode="numeric" min="0" max="86400" step="1" value={seconds} disabled={saving} aria-describedby="route-report-min-help" onChange={event => { setSeconds(event.target.value); setError(""); }} /><span>saniye</span></div></label>
        <p id="route-report-min-help" className={styles.help}>Bu süreden kısa oda ve koridor kayıtları PDF raporuna eklenmez. Süreye eşit kayıtlar gösterilir. Tüm karar kayıtlarını göstermek için 0 girin. Konum kararı olmayan aralıklar gösterilmez.</p>
        <div className={styles.presets} aria-label="Rapor süreleri">{[0, 30, 60, 120, 300].map(preset => <button key={preset} type="button" disabled={saving} aria-pressed={value === preset} onClick={() => { setSeconds(String(preset)); setError(""); }}>{preset === 0 ? "Tümü" : preset < 60 ? `${preset} sn` : `${preset / 60} dk`}</button>)}</div>
      </div>
      <aside className={styles.preview} aria-label="Rapor ayarının etkisi"><small>RAPORA DAHİL EDİLEN SÜRELER</small><p className={styles.help}>{!valid ? "Geçerli bir süre girin." : value === 0 ? "Tüm sürelerdeki kayıtlar gösterilir." : `${value % 60 === 0 ? `${value / 60} dakika` : `${value} saniye`} ve üzerindeki kayıtlar gösterilir.`}</p></aside>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <footer className={styles.cardFooter}><span><Info size={15} />Yeni oluşturulan PDF raporları için geçerlidir.</span><div><button type="button" className={styles.secondary} disabled={!dirty || saving} onClick={() => { setSeconds(String(savedSeconds)); setError(""); }}><RotateCcw size={14} />Değişiklikleri geri al</button><button type="submit" className={styles.primary} disabled={!dirty || !valid || saving}>{saving ? <Loader2 size={15} className={styles.spin} /> : <Save size={15} />}{saving ? "Kaydediliyor…" : "Değişiklikleri kaydet"}</button></div></footer>
  </form>;
}

export function SettingsPanel() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["system-settings"], queryFn: fetchSystemSettings, staleTime: 0, select: normalizeSystemSettingsResponse });
  const [activeCategory, setActiveCategory] = useState<string>(SETTINGS_CATEGORIES[0].id);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const category = SETTINGS_CATEGORIES.find(item => item.id === activeCategory) ?? SETTINGS_CATEGORIES[0];
  const Editor = category.Editor;

  async function save(settings: SystemSettings) {
    setSaving(true); setSaved(false);
    try {
      const response = await saveSystemSettings(settings);
      client.setQueryData<SystemSettingsResponse>(["system-settings"], response);
      setSaved(true);
    } finally { setSaving(false); }
  }

  return <section className={styles.panel} aria-labelledby="settings-panel-title">
    <header className={styles.header}><div><small><Settings2 size={14} />SİSTEM YÖNETİMİ</small><h1 id="settings-panel-title">Ayarlar</h1><p>Uygulamanın çalışma tercihlerini tek yerden yönetin.</p></div><span className={styles.scope}><ShieldCheck size={15} />Sistem genelinde</span></header>
    <div className={styles.layout}>
      <nav className={styles.categories} aria-label="Ayar kategorileri"><small>KATEGORİLER</small>{SETTINGS_CATEGORIES.map(item => <button key={item.id} type="button" aria-current={activeCategory === item.id ? "page" : undefined} disabled={saving} onClick={() => { setActiveCategory(item.id); setSaved(false); }}><item.icon size={18} /><span><strong>{item.title}</strong><small>{item.description}</small></span></button>)}</nav>
      <div className={styles.content}><div className={styles.sectionHeading}><h2>{category.title}</h2><p>{category.description}</p></div>
        {query.isPending && <div className={styles.loading} role="status"><Loader2 size={20} />Ayarlar yükleniyor…</div>}
        {query.isError && <div className={styles.error} role="alert"><p>{query.error.message}</p><button type="button" className={styles.secondary} onClick={() => { void query.refetch(); }}>Yeniden dene</button></div>}
        {query.data && <Editor key={`${category.id}-${category.id === "reports" ? query.data.settings.reports.routeHistoryMinDurationMs : query.data.settings.tracking.noDataHideAfterMs}`} settings={query.data.settings} saving={saving} onSave={save} />}
        {saved && <p className={styles.success} role="status"><Check size={16} />{category.id === "reports" ? "Ayar kaydedildi. Yeni oluşturulan raporlarda kullanılacak." : "Ayar kaydedildi ve mevcut taglara uygulandı."}</p>}
      </div>
    </div>
  </section>;
}
