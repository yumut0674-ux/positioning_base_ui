import { useEffect, useState } from "react";
import { parsePdopFilterSettings, type PdopFilterSettings } from "@/src/shared/tracking/pdop";
import styles from "./regions.module.css";

export function MapPdopFilterEditor({ mapId }: { mapId: string }) {
  const [saved, setSaved] = useState<PdopFilterSettings | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [maximum, setMaximum] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const endpoint = `/api/maps/${encodeURIComponent(mapId)}/tracking-filter`;

  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    void fetch(endpoint, { cache: "no-store", signal: abort.signal }).then(async response => {
      const payload = await response.json() as { settings?: unknown; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "PDOP filtre ayarları yüklenemedi");
      const settings = parsePdopFilterSettings(payload.settings);
      if (active) { setSaved(settings); setEnabled(settings.enabled); setMaximum(String(settings.maximumPdop)); setError(""); }
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "PDOP filtre ayarları yüklenemedi"); });
    return () => { active = false; abort.abort(); };
  }, [endpoint, reload]);

  const maximumPdop = maximum.trim() === "" ? Number.NaN : Number(maximum);
  const valid = Number.isFinite(maximumPdop) && maximumPdop >= 0;
  const dirty = saved !== null && (enabled !== saved.enabled || maximumPdop !== saved.maximumPdop);
  const save = async () => {
    if (!saved || !valid || saving) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled, maximumPdop }),
      });
      const payload = await response.json() as { settings?: unknown; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "PDOP filtre ayarları kaydedilemedi");
      const settings = parsePdopFilterSettings(payload.settings);
      setSaved(settings); setEnabled(settings.enabled); setMaximum(String(settings.maximumPdop));
      setMessage("Kaydedildi. Yeni konumlara uygulanıyor.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "PDOP filtre ayarları kaydedilemedi"); }
    finally { setSaving(false); }
  };

  return <section className={styles.pdopFilter} aria-label="Harita PDOP filtresi">
    <h2>Harita PDOP filtresi</h2>
    <p>Seçili haritanın tüm konumlarına uygulanır.</p>
    <label><span>PDOP filtresi</span><select value={String(enabled)} disabled={!saved || saving} onChange={event => { setEnabled(event.target.value === "true"); setMessage(""); }}>
      <option value="true">Açık</option><option value="false">Kapalı</option>
    </select></label>
    <label><span>PDOP üst sınırı</span><input type="number" min={0} step="any" value={maximum} disabled={!saved || !enabled || saving}
      aria-invalid={saved !== null && !valid} onChange={event => { setMaximum(event.target.value); setMessage(""); }} /></label>
    <p>Üst sınıra eşit değerler ve PDOP değeri bilinmeyen konumlar kabul edilir. Mevcut oda kararları korunur.</p>
    <button type="button" disabled={!dirty || !valid || saving} onClick={() => void save()}>{saving ? "Kaydediliyor…" : "PDOP filtresini kaydet"}</button>
    {!saved && !error && <p role="status">PDOP ayarları yükleniyor…</p>}
    {saved && !valid && <p className={styles.pdopError}>Üst sınır sıfır veya daha büyük bir sayı olmalıdır.</p>}
    {error && <p role="alert" className={styles.pdopError}>{error}</p>}
    {!saved && error && <button type="button" onClick={() => setReload(value => value + 1)}>Tekrar yükle</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}
