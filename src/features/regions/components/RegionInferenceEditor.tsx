import { useState } from "react";
import type { RegionDefinition } from "../types/region.types";
import styles from "./regions.module.css";

export function RegionInferenceEditor({ region, onChange }: { region: RegionDefinition; onChange: (region: RegionDefinition) => void }) {
  const [doors, setDoors] = useState(() => JSON.stringify(region.entrances, null, 2));
  const [error, setError] = useState("");
  return <section className={styles.inferenceEditor}><h3>Oda çıkarımı</h3>
    <div className={styles.inferenceFields}>
      <label><span>Alan türü</span><select value={region.kind ?? (/^corridor/.test(region.id) ? "corridor" : "room")} onChange={e => onChange({ ...region, kind: e.target.value as "room" | "corridor" })}><option value="room">Oda</option><option value="corridor">Koridor · hareketli takip</option></select></label>
      <label><span>Kapsama</span><select value={region.coverage ?? "regular"} onChange={e => onChange({ ...region, coverage: e.target.value as RegionDefinition["coverage"] })}><option value="regular">Düzenli ölçüm</option><option value="intermittent">Aralıklı ölçüm</option><option value="silent">İçeride çoğunlukla ölçüm yok</option></select></label>
      {(["expectedIntervalMs", "wallBandMeters", "sharedWallBandMeters"] as const).map((field, index) => <label key={field}><span>{["Beklenen ölçüm aralığı (ms)", "Duvar bandı (m)", "Ortak duvar bandı (m)"][index]}</span><input type="number" min="0" step="any" value={region[field] ?? ""} placeholder={["1000", "0.35", "0.65"][index]} onChange={e => onChange({ ...region, [field]: e.target.value === "" ? undefined : e.target.valueAsNumber })} /></label>)}
    </div>
    <details className={styles.entranceDetails}><summary>Kapı geometrisi ve bağlantılar</summary>
      <p>Kapı noktası world alanında; widthMeters açıklık, inwardNormal odaya bakan yön, connectsTo komşu oda kimliği veya corridor, approachDepthMeters yaklaşım derinliği, crossingDepthMeters geçiş bandıdır. Eksik geometriyle kapı geçişi çıkarımı yapılmaz.</p>
      <textarea aria-label="Kapı tanımları JSON" rows={12} value={doors} onChange={e => setDoors(e.target.value)} />
      <button type="button" onClick={() => { try { const entrances = JSON.parse(doors); if (!Array.isArray(entrances)) throw new Error("Liste gerekli"); onChange({ ...region, entrances }); setError(""); } catch (e) { setError(String(e)); } }}>Kapı tanımlarını uygula</button>
      {error && <p role="alert">{error}</p>}
    </details>
  </section>;
}
