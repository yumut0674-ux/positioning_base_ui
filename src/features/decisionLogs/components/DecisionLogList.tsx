import type { DecisionLogSummary } from "../types/decisionLog.types";
import styles from "./decisionLogs.module.css";

const eventLabels: Record<string,string> = { MEASUREMENT_ACCEPTED:"Ölçüm kabul",MEASUREMENT_REJECTED:"Ölçüm reddi",ENTRY_CANDIDATE:"Giriş adayı",ROOM_CONFIRMED:"Oda doğrulandı",ROOM_TRANSITIONED:"Oda değiştirildi",ROOM_INFERRED:"Oda tahmini",EXIT_CANDIDATE:"Çıkış adayı",ROOM_EXITED:"Odadan çıkıldı",LOCATION_LOST:"Konum kayıp",CONFIG_RELOADED:"Config yenilendi" };
const kindLabels: Record<string,string> = { measured:"Ölçülen",estimated:"Tahmini",uncertain:"Belirsiz" };

interface Props { readonly items: readonly DecisionLogSummary[]; readonly selectedId: string | null; readonly onSelect: (id: string) => void }

export function DecisionLogList({ items, selectedId, onSelect }: Props) {
  return <div className={styles.list} role="list" aria-label="Oda motoru kararları">{items.map(item => <button type="button" role="listitem" key={item.decisionId} className={`${styles.listRow} ${selectedId === item.decisionId ? styles.selected : ""}`} onClick={() => onSelect(item.decisionId)}>
    <div className={styles.rowTop}><time>{new Date(item.publishedAt).toLocaleString("tr-TR")}</time><strong>{item.tagCode}</strong><span className={`${styles.event} ${styles[item.severity]}`}>{eventLabels[item.eventType] ?? item.eventType}</span></div>
    <div className={styles.transition}>{item.previousState ?? "—"} <b>→</b> {item.nextState}</div>
    <div className={styles.rowFacts}><span>X/Y {item.rawX?.toFixed(2) ?? "—"} / {item.rawY?.toFixed(2) ?? "—"}</span><span>{item.regionName ?? item.regionId ?? item.candidateRegionId ?? "Oda yok"}</span>{item.confidence !== undefined && <span>%{Math.round(item.confidence * 100)}</span>}<i className={`${styles.kind} ${styles[item.measurementKind ?? "uncertain"]}`}>{kindLabels[item.measurementKind ?? "uncertain"]}</i></div>
    <p>{item.shortReason ?? "Gerekçe açıklaması bulunmuyor."}</p>
  </button>)}</div>;
}
