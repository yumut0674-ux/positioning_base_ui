import { useState } from "react";
import { Check, Clipboard, ChevronDown } from "lucide-react";
import type { DecisionLogDetail as DecisionLogDetailType } from "../types/decisionLog.types";
import styles from "./decisionLogs.module.css";

const show = (value: unknown, suffix = "") => value === undefined || value === null || value === "" ? "—" : `${value}${suffix}`;
const number = (value: number | undefined, digits = 2, suffix = "") => value === undefined ? "—" : `${value.toFixed(digits)}${suffix}`;

export function DecisionLogDetail({ item, loading, error, onBack }: { readonly item: DecisionLogDetailType | null; readonly loading: boolean; readonly error?: string | null; readonly onBack: () => void }) {
  const [copied, setCopied] = useState(false); const trace=item?.decisionTrace; const e=trace?.evidence;
  if (loading) return <aside className={styles.detail} role="status">Karar ayrıntısı yükleniyor…</aside>;
  if (error) return <aside className={styles.detail}><p className={styles.error} role="alert">{error}</p></aside>;
  if (!item) return <aside className={styles.detail}><div className={styles.detailEmpty}>İncelemek için bir karar kaydı seçin.</div></aside>;
  const copy = async () => { await navigator.clipboard.writeText(JSON.stringify(item.payload,null,2)); setCopied(true); window.setTimeout(()=>setCopied(false),1500); };
  const latency = Date.parse(item.publishedAt)-Date.parse(item.measuredAt);
  return <aside className={styles.detail} aria-label="Karar ayrıntısı">
    <div className={styles.detailHeader}><button type="button" className={styles.mobileBack} onClick={onBack}>← Liste</button><div><small>KARAR AYRINTISI</small><h2>{item.tagCode}</h2></div><span className={styles.detailEvent}>{item.eventType}</span></div>
    <section><h3>Zaman ve kimlik</h3><dl><dt>Karar kimliği</dt><dd className={styles.mono}>{item.decisionId}</dd><dt>Ölçüm zamanı</dt><dd>{new Date(item.measuredAt).toLocaleString("tr-TR")}</dd><dt>Sisteme geliş</dt><dd>{item.receivedAt ? new Date(item.receivedAt).toLocaleString("tr-TR") : "—"}</dd><dt>Yayın zamanı</dt><dd>{new Date(item.publishedAt).toLocaleString("tr-TR")}</dd><dt>İşleme gecikmesi</dt><dd>{show(latency," ms")}</dd></dl></section>
    <section><h3>Konum ve durum</h3><dl><dt>Son ham X / Y</dt><dd>{number(item.rawX)} / {number(item.rawY)}</dd><dt>Yayımlanan X / Y</dt><dd>{number(item.publishedX)} / {number(item.publishedY)}</dd><dt>Durum</dt><dd>{trace?.previousState ?? "—"} → {trace?.nextState ?? item.nextState}</dd><dt>Önceki oda</dt><dd>{show(item.payload.regionInference && (item.payload.regionInference as Record<string,unknown>).lastKnownRegionId)}</dd><dt>Aday oda</dt><dd>{show(trace?.outcome.candidateRegionId)}</dd><dt>Seçilen oda</dt><dd>{show(trace?.outcome.regionName ?? trace?.outcome.regionId)}</dd><dt>Son güvenilir konum</dt><dd>{e?.lastReliableLocation ? `${number(e.lastReliableLocation.x)} / ${number(e.lastReliableLocation.y)}` : "—"}</dd><dt>Sinyal kesintisi</dt><dd>{show(trace?.input.signalGapMs," ms")}</dd></dl></section>
    <section><h3>Kapı ve kanıt</h3><dl><dt>Kapı kimliği</dt><dd>{show(e?.doorId)}</dd><dt>Kapıya uzaklık</dt><dd>{number(e?.doorDistanceMeters,2," m")}</dd><dt>Mesafe eşiği</dt><dd>{number(e?.allowedDoorDistanceMeters,2," m")}</dd><dt>Ölçüm sayısı</dt><dd>{show(e?.collectedMeasurements)} / {show(e?.requiredMeasurements)}</dd><dt>Kanıt süresi</dt><dd>{show(e?.collectedDurationMs," ms")} / {show(e?.requiredDurationMs," ms")}</dd><dt>Donanım kalitesi</dt><dd>{show(trace?.input.quality)}</dd></dl>
      {e?.score && <div className={styles.scoreGrid}>{Object.entries(e.score).map(([key,value])=><div key={key}><span>{key}</span><strong>{number(value,2)}</strong></div>)}</div>}
    </section>
    {e?.stepDistance && <section><h3>Nokta mesafesi filtresi</h3><dl>
      <dt>Referansa uzaklık / eşik</dt><dd>{number(e.stepDistance.distanceMeters,2," m")} / {number(e.stepDistance.maximumDistanceMeters,2," m")}</dd>
      <dt>Karşılaştırma referansı</dt><dd>{number(e.stepDistance.reference.x)} / {number(e.stepDistance.reference.y)} · {new Date(e.stepDistance.reference.measuredAt).toLocaleString("tr-TR")}</dd>
      <dt>Yeni konum aday ölçümleri</dt><dd>{e.stepDistance.candidateCount} / {e.stepDistance.requiredCount}</dd>
      <dt>Aday süresi</dt><dd>{show(e.stepDistance.candidateDurationMs," ms")} / {show(e.stepDistance.requiredDurationMs," ms")}</dd>
      <dt>Takip referansı</dt><dd>{e.stepDistance.referenceReset ? "Yeniden kuruldu; sonraki ölçümle oda kanıtı başlayacak" : "Yeni konum doğrulaması bekleniyor"}</dd>
      <dt>Oda kanıtına dahil</dt><dd>Hayır</dd>
    </dl></section>}
    <section><h3>Gerekçeler</h3><div className={styles.reasons}>{trace?.reasons.length ? trace.reasons.map(reason=><div key={`${reason.code}-${reason.message}`}><code>{reason.code}</code><p>{reason.message}</p></div>) : <p>Yapılandırılmış gerekçe bulunmuyor.</p>}</div></section>
    <section><h3>Sürümler</h3><dl><dt>Motor</dt><dd>{item.engineVersion}</dd><dt>Konfigürasyon</dt><dd>{item.configVersion}</dd></dl></section>
    <details className={styles.raw}><summary><ChevronDown size={14}/> Ham JSON <button type="button" onClick={event=>{event.preventDefault();void copy();}}>{copied?<Check size={14}/>:<Clipboard size={14}/>} {copied?"Kopyalandı":"JSON kopyala"}</button></summary><pre>{JSON.stringify(item.payload,null,2)}</pre></details>
  </aside>;
}
