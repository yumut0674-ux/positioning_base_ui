import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import type { AdminRouteReportData, AdminRouteReportRow } from "../../features/reports/types/adminRouteReport.types";
import { createReportWorkbook } from "./decisionReportXlsx";
import { DecisionReportError } from "./decisionReportRequest";
import { renderReportPdf } from "./reportPdfWorker";

const clock = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
export const adminRouteTime = (value: string) => clock.format(new Date(value));
export function adminRouteDuration(ms: number): string {
  if (!ms) return "0 sn";
  if (ms < 1000) return `${ms} ms`;
  const total = ms / 1000, hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60);
  const seconds = Number((total % 60).toFixed(3)).toLocaleString("tr-TR", { maximumFractionDigits: 3 });
  return [hours ? `${hours} sa` : "", minutes ? `${minutes} dk` : "", total % 60 ? `${seconds} sn` : ""].filter(Boolean).join(" ");
}
export function adminRouteStatus(row: AdminRouteReportRow): string {
  if (row.kind === "gap") return "Veri yok";
  if (row.kind === "outside") return "Alan dışı";
  if (row.kind === "uncertain") return row.candidateRoomId ? "Oda adayı" : "Belirsiz";
  return row.measurementKinds.filter(Boolean).map(kind => ({ measured: "Ölçülen", estimated: "Tahmini", uncertain: "Belirsiz" })[kind] ?? kind).join(" / ") || "Karar";
}
type Cell = string | number;
const titles = ["Sıra", "Tag adı", "Tag kodu", "Başlangıç (TR)", "Bitiş (TR)", "Kat / harita", "Konum", "Kalış", "Süre (saniye)", "Karar"];
function values(row: AdminRouteReportRow, index: number, excel = false): Cell[] {
  const time = (value: string) => excel ? Date.parse(value) / 86_400_000 + 25_569 + 3 / 24 : adminRouteTime(value);
  return [index + 1, row.tagName, row.tagCode, time(row.from), time(row.to), row.mapName || "—", row.location,
    adminRouteDuration(row.durationMs), row.durationMs / 1000, adminRouteStatus(row)];
}
const scopeInfo = (report: AdminRouteReportData): readonly (readonly [string, string | number])[] => [
  ["Rapor", "Yönetici oda ve koridor raporu"], ["Başlangıç (TR)", adminRouteTime(report.from)], ["Bitiş (TR)", adminRouteTime(report.to)],
  ["Saat dilimi", report.timezone], ["Tag", report.filters.tagCode ?? "Tümü"], ["Harita ID", report.filters.mapId ?? "Tümü"],
  ["Oda ID", report.filters.regionId ?? "Tümü"], ["Konum aralığı", report.rows.length], ["Minimum süre filtresi", "Uygulanmadı"],
  ["Birleştirme", "Yalnızca kesintisiz aynı konum. Aradaki koridor, başka oda, belirsizlik veya veri boşluğu korunur."],
  ["Zaman", "Kaydedilmiş kararların yayımlanma sırası ve geçerlilik sınırları kullanılır. Başlangıç ve bitiş rapor aralığıyla sınırlıdır; fiziksel giriş/çıkışın kesin ölçümü değildir."],
  ["Belirsizlik", "Oda adayları doğrulanmış oda kalışı sayılmaz. Konum belirsizliği koridor olarak doldurulmaz."],
];

export function adminRouteCsv(report: AdminRouteReportData): string {
  const cell = (value: Cell) => {
    const text = typeof value === "string" && /^[\s\uFEFF]*[=+@-]/.test(value) ? `'${value}` : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + [titles, ...report.rows.map((row, i) => values(row, i))].map(row => row.map(cell).join(",")).join("\r\n");
}
export function createAdminRouteXlsx(report: AdminRouteReportData): Uint8Array {
  return createReportWorkbook({ sheetName: "Oda_Koridor", rows: [titles, ...report.rows.map((row, i) => values(row, i, true))],
    widths: [8, 27, 22, 24, 24, 25, 32, 25, 19, 25], dateColumns: [3, 4], freezeColumns: 3, info: scopeInfo(report) });
}
export function buildAdminRouteDefinition(report: AdminRouteReportData, logo = ""): TDocumentDefinitions {
  if (report.rows.length > 5000) throw new DecisionReportError("PDF için en fazla 5.000 konum aralığı seçin. Tarih aralığını daraltın veya Excel biçimini seçin. Eksik PDF oluşturulmadı.", 422);
  const content: Content[] = [
    { text: "YÖNETİCİ ODA VE KORİDOR RAPORU", fontSize: 16, bold: true, margin: [0, 0, 0, 10] },
    { text: `Aralık: ${adminRouteTime(report.from)} - ${adminRouteTime(report.to)} (TR)`, margin: [0, 0, 0, 5] },
    { text: `${report.rows.length} konum aralığı. Minimum süre filtresi uygulanmadı.`, fontSize: 9, margin: [0, 0, 0, 10] },
  ];
  const tags = new Map<string, AdminRouteReportRow[]>();
  for (const row of report.rows) { const list = tags.get(row.tagCode) ?? []; list.push(row); tags.set(row.tagCode, list); }
  for (const [tagCode, rows] of tags) {
    content.push({ text: `${rows[0].tagName} (${tagCode})`, bold: true, fontSize: 11, margin: [0, 10, 0, 7] });
    const body: TableCell[][] = [["Başlangıç (TR)", "Bitiş (TR)", "Kat / harita", "Konum", "Kalış", "Karar"].map(text => ({ text, bold: true, fillColor: "#243B53", color: "#FFFFFF", margin: [3, 5, 3, 5] }))];
    for (const [i, row] of rows.entries()) {
      const fillColor = row.kind === "uncertain" || row.kind === "gap" ? "#FFF7DF" : i % 2 ? "#F1F6FA" : "#FFFFFF";
      body.push([adminRouteTime(row.from), adminRouteTime(row.to), row.mapName || "—", row.location, adminRouteDuration(row.durationMs), adminRouteStatus(row)]
        .map(text => ({ text: text.replace(/\S{25,}/gu, token => token.match(/.{1,24}/gu)!.join("\n")), fillColor, margin: [3, 5, 3, 5] })));
    }
    content.push({ table: { headerRows: 1, widths: [87, 87, 63, "*", 60, 62], body, dontBreakRows: true }, layout: "reportGrid", margin: [0, 0, 0, 9] });
  }
  content.push({ text: "Kesintisiz aynı konum tek kalıştır. Oda - koridor - aynı oda ayrı aralıklardır; kısa koridorlar ve ziyaretler gizlenmez. Belirsizlik ve veri boşluğu oda süresine eklenmez. Saatler kararın yayımlanma sırasını gösterir; rapor sınırı fiziksel giriş veya çıkış anlamına gelmez.", fontSize: 8, color: "#526675", margin: [0, 12, 0, 0] });
  return { pageSize: "A4", pageOrientation: "portrait", pageMargins: [30, 75, 30, 45], defaultStyle: { font: "Roboto", fontSize: 8 }, content,
    header: { columns: [...(logo ? [{ svg: logo, width: 95 }] : []), { text: `Oluşturma: ${adminRouteTime(report.generatedAt)}`, alignment: "right", fontSize: 8, margin: [0, 12, 0, 0] }], margin: [30, 22, 30, 0] } };
}
export async function createAdminRoutePdf(report: AdminRouteReportData): Promise<Uint8Array> {
  const logo = await readFile(path.join(process.cwd(), "trlogo.svg"), "utf8");
  return renderReportPdf(buildAdminRouteDefinition(report, logo));
}
