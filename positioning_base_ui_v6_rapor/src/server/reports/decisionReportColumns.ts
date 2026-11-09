import type { DecisionReportData, DecisionReportItem } from "../../features/reports/types/decisionReport.types";

const stamp = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
export const decisionReportTime = (value: string) => stamp.format(new Date(value));
export const kindLabel = (value: string) => ({ measured: "Ölçülen", estimated: "Tahmini", uncertain: "Belirsiz" })[value] ?? value;
export const triggerLabel = (value: string) => ({ measurement: "Ölçüm", timer: "Zamanlayıcı", config_reload: "Ayar yenileme" })[value] ?? value;
export const eventLabel = (value: string) => ({
  MEASUREMENT_ACCEPTED: "Ölçüm kabulü", MEASUREMENT_REJECTED: "Ölçüm reddi", ENTRY_CANDIDATE: "Giriş adayı",
  ROOM_CONFIRMED: "Oda doğrulandı", ROOM_TRANSITIONED: "Oda değişimi", ROOM_INFERRED: "Oda tahmini",
  EXIT_CANDIDATE: "Çıkış adayı", ROOM_EXITED: "Odadan çıkış", LOCATION_LOST: "Konum kayıp", CONFIG_RELOADED: "Ayar yenileme",
})[value] ?? value;

type CellValue = string | number | undefined;
interface Column { readonly title: string; readonly width: number; readonly value: (item: DecisionReportItem, index: number) => CellValue }
export const decisionReportColumns: readonly Column[] = [
  { title: "Sıra", width: 8, value: (_, i) => i + 1 },
  { title: "Karar zamanı (TR)", width: 23, value: i => decisionReportTime(i.publishedAt) },
  { title: "Tag adı", width: 27, value: i => i.tagName },
  { title: "Tag kodu", width: 22, value: i => i.tagCode },
  { title: "Harita / kat", width: 24, value: i => i.mapName },
  { title: "Harita ID", width: 23, value: i => i.mapId },
  { title: "Önceki durum", width: 26, value: i => i.previousState },
  { title: "Yeni durum", width: 26, value: i => i.nextState },
  { title: "Olay türü", width: 29, value: i => i.eventType },
  { title: "Atanmış oda", width: 24, value: i => i.regionName },
  { title: "Atanmış oda ID", width: 19, value: i => i.regionId },
  { title: "Aday oda (güncel ad)", width: 24, value: i => i.candidateRegionName },
  { title: "Aday oda ID", width: 19, value: i => i.candidateRegionId },
  { title: "Ölçüm türü", width: 16, value: i => kindLabel(i.measurementKind) },
  { title: "Konum güveni (0–1)", width: 20, value: i => i.confidence },
  { title: "Karar kaynağı", width: 19, value: i => triggerLabel(i.trigger) },
  { title: "Zamanlayıcı kaydı", width: 19, value: i => i.synthetic ? "Evet" : "Hayır" },
  { title: "Ham X", width: 12, value: i => i.rawX },
  { title: "Ham Y", width: 12, value: i => i.rawY },
  { title: "Yayımlanan X", width: 16, value: i => i.publishedX },
  { title: "Yayımlanan Y", width: 16, value: i => i.publishedY },
  { title: "Kapı ID", width: 22, value: i => i.doorId },
  { title: "Kapı uzaklığı (m)", width: 20, value: i => i.doorDistanceMeters },
  { title: "Neden kodları", width: 55, value: i => i.reasonCodes.join(" | ") },
  { title: "Gerekçe", width: 85, value: i => i.reasonText },
  { title: "Motor sürümü", width: 22, value: i => i.engineVersion },
  { title: "Yapılandırma sürümü", width: 26, value: i => i.configVersion },
  { title: "Karar kimliği", width: 65, value: i => i.decisionId },
];

export function decisionReportInfo(report: DecisionReportData): readonly (readonly [string, string | number])[] {
  return [
    ["Rapor", "Yönetici motor karar raporu"], ["Başlangıç (TR)", decisionReportTime(report.from)],
    ["Bitiş (TR)", decisionReportTime(report.to)], ["Oluşturma (TR)", decisionReportTime(report.generatedAt)],
    ["Saat dilimi", report.timezone], ["Tag", report.filters.tagCode ?? "Tüm taglar"],
    ["Harita ID", report.filters.mapId ?? "Tüm haritalar"], ["Oda / aday oda ID", report.filters.regionId ?? "Tümü"],
    ["Benzersiz motor kararı", report.items.length], ["Süre filtresi", "Uygulanmadı"], ["Ardışık karar birleştirme", "Uygulanmadı"],
    ["Kapsam", "Kayıtlı tüm motor kararları: aday, belirsiz, reddedilen ve zamanlayıcı geçişleri dahil. Bildirimler motor kararı değildir."],
    ["Zaman", "Karar zamanı, motorun yayımlanma zamanıdır. Saniye gösterimi kararların özgün sırasını veya kimliğini değiştirmez."],
    ["Oda adları", "Kayda yazılmış oda adı korunur. Eksik oda ve aday adları güncel harita tanımından tamamlanır; oda ID bilgisi ayrıca korunur."],
    ["Süreler", "Bir karar kaydı oda ziyareti veya doğrulanmış kalış süresi değildir. Kararlar birleştirilmemiştir."],
    ["Güven", "Konum güveni aday odanın olasılığı değildir. Kaynakta bulunmayan değerler boş bırakılır."],
    ["Ayrıntı", "Özgün kayıtlar ve zaman hassasiyeti tam JSON çıktısında korunur."],
  ];
}

// Treat user/device strings as text in spreadsheet programs, including CSV formula prefixes.
function csvCell(value: CellValue): string {
  const raw = value == null ? "" : String(value);
  const text = typeof value === "string" && /^[\s\uFEFF]*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${text.replaceAll('"', '""')}"`;
}
export function decisionReportCsv(report: DecisionReportData): string {
  return "\uFEFF" + [decisionReportColumns.map(column => csvCell(column.title)).join(","),
    ...report.items.map((item, index) => decisionReportColumns.map(column => csvCell(column.value(item, index))).join(","))].join("\r\n");
}
