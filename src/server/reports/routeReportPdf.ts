import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import type { RouteReportData } from "./routeReportService";
import type { ReportRow } from "./routeReport";

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

export async function createRouteReportPdf(report: RouteReportData): Promise<Uint8Array> {
  // pdfmake is CommonJS; let Node load it without Vite transforming fontkit's require calls.
  const nodeRequire = createRequire(path.join(process.cwd(), "package.json"));
  const PdfPrinter = nodeRequire("pdfmake") as typeof import("pdfmake");
  const assetDirectory = path.join(process.cwd(), "src", "server", "reports", "assets");
  const [regular, medium, sourceLogo] = await Promise.all([
    readFile(path.join(assetDirectory, "Roboto-Regular.ttf")),
    readFile(path.join(assetDirectory, "Roboto-Medium.ttf")),
    readFile(path.join(process.cwd(), "trlogo.svg"), "utf8"),
  ]);
  const logo = sourceLogo;
  const printer = new PdfPrinter({ Roboto: { normal: regular, bold: medium, italics: regular, bolditalics: medium } });
  const content: Content[] = [
    { text: "ROTA GEÇMİŞİ RAPORU", style: "title" },
    { text: `Rapor aralığı: ${formatStamp(report.from)} – ${formatStamp(report.to)}`, margin: [0, 0, 0, 4] },
    { text: `Seçilen taglar: ${report.tags.map(tag => tag.displayName === tag.tagCode ? tag.tagCode : `${tag.displayName} (${tag.tagCode})`).join(", ")}`, margin: [0, 0, 0, 4] },
    { text: `Oda: ${report.room ? `${report.room.mapName} / ${report.room.roomName}` : "Tüm odalar"}`, margin: [0, 0, 0, 15] },
  ];
  for (const tag of report.tags) {
    content.push({ text: tag.displayName === tag.tagCode ? tag.tagCode : `${tag.displayName} · ${tag.tagCode}`, style: "tagHeading", margin: [0, 10, 0, 7] });
    if (!tag.hasRecords) content.push({ text: report.room ? "Bu tag için seçilen odada hesaplanabilir kalış yok." : "Bu tag için seçilen aralıkta konum kaydı yok.", color: "#555555", margin: [0, 0, 0, 7] });
    const body: TableCell[][] = [["Tarih", "Giriş saati", "Çıkış saati", "Kat", "Oda", "Kalış süresi"].map(text => ({ text, bold: true, fillColor: "#E6E6E6", color: "#111111", margin: [3, 5, 3, 5] }))];
    for (const row of tag.rows.flatMap(splitAtMidnight)) {
      const from = Date.parse(row.from), to = Date.parse(row.to);
      body.push([
        formatDate(row.from), formatTime(row.from), formatTime(row.to), row.floor, row.room,
        row.gap || row.room === "—" || row.room === "Koridor" ? "—" : duration(from, to),
      ].map(text => ({ text, margin: [3, 4, 3, 4], color: row.gap ? "#555555" : "#111111" })));
    }
    content.push({ table: { headerRows: 1, widths: [77, 63, 63, 82, "*", 70], body, dontBreakRows: true },
      layout: { hLineColor: () => "#BDBDBD", vLineColor: () => "#D4D4D4", hLineWidth: () => .5, vLineWidth: () => .5 }, margin: [0, 0, 0, 6] });
  }
  content.push({ text: report.room
    ? "Yalnızca seçilen odadaki kalışlar ve veri bulunmayan süreler gösterilir. Diğer konumlar gösterilmez; veri bulunmayan süreler oda kalışına dahil edilmez."
    : "Veri yok satırları ölçüm bulunmayan süreleri gösterir. Bu süreler oda kalışına dahil edilmemiştir.", color: "#555555", fontSize: 8, margin: [0, 12, 0, 0] });
  const definition: TDocumentDefinitions = {
    pageSize: "A4", pageOrientation: "portrait", pageMargins: [40, 82, 40, 48],
    defaultStyle: { font: "Roboto", fontSize: 9, color: "#111111" },
    styles: { title: { fontSize: 17, bold: true, margin: [0, 0, 0, 14] }, tagHeading: { fontSize: 11, bold: true } },
    header: () => ({ columns: [{ svg: logo, width: 105 }, { text: `Oluşturma tarihi: ${formatStamp(report.generatedAt)}`, alignment: "right", fontSize: 8, color: "#555555", margin: [0, 15, 0, 0] }], margin: [40, 22, 40, 0] }),
    footer: (page, total) => ({ text: `Sayfa ${page} / ${total}`, alignment: "right", fontSize: 8, color: "#555555", margin: [40, 10, 40, 0] }),
    content,
  };
  const document = printer.createPdfKitDocument(definition);
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = [];
    document.on("data", chunk => chunks.push(Buffer.from(chunk)));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    document.end();
  });
}
