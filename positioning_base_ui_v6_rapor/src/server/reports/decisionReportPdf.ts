import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import type { DecisionReportData } from "../../features/reports/types/decisionReport.types";
import { decisionReportTime, eventLabel, kindLabel, triggerLabel } from "./decisionReportColumns";
import { DecisionReportError } from "./decisionReportService";
import { renderReportPdf } from "./reportPdfWorker";

export function buildDecisionReportDefinition(report: DecisionReportData, logo = ""): TDocumentDefinitions {
  if (report.items.length > 5_000) throw new DecisionReportError("PDF için en fazla 5.000 karar seçin. Tüm kayıtları indirmek için Excel, CSV veya JSON biçimini kullanın. Eksik PDF oluşturulmadı.", 422);
  const room = (id: string, name: string) => !id ? "—" : name && name !== id ? `${name}\n${id}` : id;
  const body: TableCell[][] = [["Sıra", "Karar zamanı (TR)", "Tag", "Durum geçişi", "Atanmış oda", "Aday oda*", "Tür / Kaynak", "Olay", "Gerekçe"].map(text => ({ text, bold: true, fillColor: "#243B53", color: "#FFFFFF", margin: [2, 5, 2, 5] }))];
  for (const [index, item] of report.items.entries()) {
    const fillColor = item.eventType === "MEASUREMENT_REJECTED" ? "#FCECEB" : item.measurementKind === "uncertain" ? "#FFF7DF" : index % 2 ? "#F1F6FA" : "#FFFFFF";
    body.push([
      String(index + 1), decisionReportTime(item.publishedAt), item.tagName === item.tagCode ? item.tagCode : `${item.tagName}\n${item.tagCode}`,
      `${item.previousState || "—"}\n->\n${item.nextState}`, room(item.regionId, item.regionName), room(item.candidateRegionId, item.candidateRegionName),
      `${kindLabel(item.measurementKind) || "—"}\n${triggerLabel(item.trigger)}${item.confidence == null ? "" : `\nKonum güveni: %${Math.round(item.confidence * 100)}`}`,
      eventLabel(item.eventType), `${item.mapName || "—"}\n${item.reasonText || item.reasonCodes.join(" | ") || "—"}\nID: ${item.decisionId}`,
    ].map(text => ({ text: text.replace(/\S{33,}/gu, token => token.match(/.{1,32}/gu)!.join("\n")), fillColor, margin: [2, 4, 2, 4] })));
  }
  const content: Content[] = [
    { text: "YÖNETİCİ MOTOR KARAR RAPORU", fontSize: 16, bold: true, margin: [0, 0, 0, 10] },
    { text: `Aralık: ${decisionReportTime(report.from)} – ${decisionReportTime(report.to)} · Türkiye saati`, margin: [0, 0, 0, 4] },
    { text: `Tag: ${report.filters.tagCode ?? "Tümü"} · Harita: ${report.filters.mapId ?? "Tümü"} · Oda / aday oda: ${report.filters.regionId ?? "Tümü"}`, margin: [0, 0, 0, 4] },
    { text: `${report.items.length} benzersiz motor kararı · Süre filtresi uygulanmadı · Ardışık kararlar birleştirilmedi`, bold: true, margin: [0, 0, 0, 9] },
    { text: "Karar zamanı, motorun kararı yayımladığı zamandır. Her satır ayrı bir karardır; oda ziyareti veya kalış süresi değildir. Aday, belirsiz, reddedilen ve kayıtlı zamanlayıcı geçişleri dahildir.", color: "#526675", fontSize: 8, margin: [0, 0, 0, 9] },
    { table: { headerRows: 1, widths: [20, 72, 88, 90, 65, 65, 55, 67, "*"], body }, layout: "reportGrid" },
    { text: "* Aday adları güncel harita tanımından alınır; oda ID bilgisi korunur. Konum güveni aday odanın olasılığı değildir. Özgün kayıtlar, motor/yapılandırma sürümleri ve ayrıntılar Excel/JSON çıktısında bulunur.", color: "#526675", fontSize: 7, margin: [0, 10, 0, 0] },
  ];
  const definition: TDocumentDefinitions = {
    pageSize: "A4", pageOrientation: "landscape", pageMargins: [28, 65, 28, 35], defaultStyle: { font: "Roboto", fontSize: 6.5 }, content,
    header: { columns: [...(logo ? [{ svg: logo, width: 85 }] : []), { text: `Oluşturma: ${decisionReportTime(report.generatedAt)}`, alignment: "right", fontSize: 8, margin: [0, 10, 0, 0] }], margin: [28, 18, 28, 0] },
  };
  return definition;
}

export async function createDecisionReportPdf(report: DecisionReportData): Promise<Uint8Array> {
  const logo = await readFile(path.join(process.cwd(), "trlogo.svg"), "utf8");
  return renderReportPdf(buildDecisionReportDefinition(report, logo));
}
