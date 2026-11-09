import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import type { RouteReportData } from "./routeReportService";
import type { ReportRow } from "./routeReport";
import { DEFAULT_SYSTEM_SETTINGS, type ReportDurationSettings } from "../../features/settings/types/settings.types";
import { renderReportPdf } from "./reportPdfWorker";

const dateFormat = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const stampFormat = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const formatDate = (value: string) => dateFormat.format(new Date(value));
const formatTime = (value: string) => timeFormat.format(new Date(value));
const formatStamp = (value: string) => stampFormat.format(new Date(value));

function duration(start: number, end: number): string {
  const minutes = Math.round((end - start) / 60_000);
  if (minutes === 0) return "< 1 dk";
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} sa ${minutes % 60} dk` : `${minutes} dk`;
}

function splitAtMidnight(row: ReportRow): ReportRow[] {
  const result: ReportRow[] = [];
  let start = Date.parse(row.from);
  const end = Date.parse(row.to);
  while (start < end) {
    const local = new Date(start + 3 * 3_600_000);
    const nextMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - 3 * 3_600_000;
    const stop = Math.min(end, nextMidnight);
    result.push({ ...row, from: new Date(start).toISOString(), to: new Date(stop).toISOString() });
    start = stop;
  }
  return result;
}

interface PdfReportRow extends ReportRow { readonly durationMs: number }

export function visibleReportRows(rows: readonly ReportRow[], settings: ReportDurationSettings): PdfReportRow[] {
  const result: PdfReportRow[] = [];
  for (const row of rows.flatMap(splitAtMidnight)) {
    const durationMs = Date.parse(row.to) - Date.parse(row.from);
    const minimumDurationMs = row.roomId ? settings.routeHistoryRoomMinDurationMs : settings.routeHistoryCorridorMinDurationMs;
    if (row.gap || (!row.roomId && row.room !== "Koridor") || durationMs < minimumDurationMs) continue;
    const previous = result.at(-1);
    if (previous && previous.mapId === row.mapId && previous.roomId === row.roomId
      && formatDate(previous.from) === formatDate(row.from)) {
      // Match the original end-user report: group locations after filtering, while
      // summing only included intervals rather than crediting the hidden time.
      result[result.length - 1] = { ...previous, to: row.to, durationMs: previous.durationMs + durationMs };
    } else result.push({ ...row, durationMs });
  }
  return result;
}

export function buildRouteReportDefinition(report: RouteReportData, options: ReportDurationSettings | number = DEFAULT_SYSTEM_SETTINGS.reports, logo = ""): TDocumentDefinitions {
  const settings = typeof options === "number" ? { routeHistoryRoomMinDurationMs: options, routeHistoryCorridorMinDurationMs: options } : options;
  const content: Content[] = [
    { text: "ROTA GEÇMİŞİ RAPORU", style: "title" },
    { text: `Rapor aralığı: ${formatStamp(report.from)} – ${formatStamp(report.to)}`, margin: [0, 0, 0, 4] },
    { text: `Seçilen taglar: ${report.tags.map(tag => tag.displayName === tag.tagCode ? tag.tagCode : `${tag.displayName} (${tag.tagCode})`).join(", ")}`, margin: [0, 0, 0, 4] },
    { text: `Oda: ${report.room ? `${report.room.mapName} / ${report.room.roomName}` : "Tüm odalar"}`, margin: [0, 0, 0, 4] },
    { text: `En kısa süre: oda ${settings.routeHistoryRoomMinDurationMs / 1_000} sn · koridor ${settings.routeHistoryCorridorMinDurationMs / 1_000} sn (0: süre filtresi kapalı)`, fontSize: 8, color: "#555555", margin: [0, 0, 0, 15] },
  ];
  for (const tag of report.tags) {
    content.push({ text: tag.displayName === tag.tagCode ? tag.tagCode : `${tag.displayName} · ${tag.tagCode}`, style: "tagHeading", margin: [0, 10, 0, 7] });
    if (!tag.hasRecords) content.push({ text: report.room ? "Bu tag için seçilen odada hesaplanabilir kalış yok." : "Bu tag için seçilen aralıkta konum kaydı yok.", color: "#555555", margin: [0, 0, 0, 7] });
    for (const exit of tag.exits ?? []) {
      const clock = new Date(exit.at).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour12: false });
      content.push({ text: `${formatDate(exit.at)} ${clock} · ${exit.floor} · Alandan çıktı${exit.gate ? ` · ${exit.gate}` : ""}`, margin: [0, 2, 0, 7] });
    }
    const rows = visibleReportRows(tag.rows, settings);
    if (!rows.length) {
      if (tag.hasRecords && !tag.exits?.length) content.push({ text: "Seçilen minimum süreyi karşılayan oda veya koridor kararı yok.", color: "#555555", margin: [0, 0, 0, 7] });
      continue;
    }
    const body: TableCell[][] = [["Tarih", "Giriş saati", "Çıkış saati", "Kat", "Oda", "Kalış süresi"].map(text => ({ text, bold: true, fillColor: "#E6E6E6", color: "#111111", margin: [3, 5, 3, 5] }))];
    for (const row of rows) {
      body.push([
        formatDate(row.from), formatTime(row.from), formatTime(row.to), row.floor, row.room,
        duration(0, row.durationMs),
      ].map(text => ({ text, margin: [3, 4, 3, 4], color: "#111111" })));
    }
    content.push({ table: { headerRows: 1, widths: [77, 63, 63, 82, "*", 70], body, dontBreakRows: true },
      layout: "reportGrid", margin: [0, 0, 0, 6] });
  }
  content.push({ text: `${report.room ? "Yalnızca seçilen odanın kalışları gösterilir." : "Alan çıkışları olay, oda ve koridor kararları kalış olarak gösterilir."} Filtreleme sonrası aynı gün ve katta ardışık görünen aynı konumlar tek satırda toplanır. Giriş ve çıkış saatleri ilk ve son kaydın sınırlarıdır. Kalış süresi yalnızca rapora alınan aralıkların toplamıdır; gizlenen süreler eklenmez.`, color: "#555555", fontSize: 8, margin: [0, 12, 0, 0] });
  const definition: TDocumentDefinitions = {
    pageSize: "A4", pageOrientation: "portrait", pageMargins: [40, 82, 40, 48],
    defaultStyle: { font: "Roboto", fontSize: 9, color: "#111111" },
    styles: { title: { fontSize: 17, bold: true, margin: [0, 0, 0, 14] }, tagHeading: { fontSize: 11, bold: true } },
    header: { columns: [...(logo ? [{ svg: logo, width: 105 }] : []), { text: `Oluşturma tarihi: ${formatStamp(report.generatedAt)}`, alignment: "right", fontSize: 8, color: "#555555", margin: [0, 15, 0, 0] }], margin: [40, 22, 40, 0] },
    content,
  };
  return definition;
}

export async function createRouteReportPdf(report: RouteReportData, options: ReportDurationSettings | number = DEFAULT_SYSTEM_SETTINGS.reports): Promise<Uint8Array> {
  const logo = await readFile(path.join(process.cwd(), "trlogo.svg"), "utf8");
  return renderReportPdf(buildRouteReportDefinition(report, options, logo));
}
