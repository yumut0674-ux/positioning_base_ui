import { logger } from "../logger";
import { DecisionReportError, loadDecisionReport, validateDecisionReportRequest } from "./decisionReportService";
import { createDecisionReportPdf } from "./decisionReportPdf";
import { createDecisionReportXlsx } from "./decisionReportXlsx";
import { decisionReportCsv } from "./decisionReportColumns";

export function createDecisionReportHandler(load = loadDecisionReport, now = () => new Date()) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const generatedAt = now();
      const input = validateDecisionReportRequest(await request.json(), generatedAt);
      const report = await load(input, generatedAt);
      const format = input.format;
      const bytes = format === "pdf" ? await createDecisionReportPdf(report) : format === "xlsx" ? createDecisionReportXlsx(report)
        : Buffer.from(format === "csv" ? decisionReportCsv(report) : JSON.stringify(report, null, 2), "utf8");
      const contentType = { pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv;charset=utf-8", json: "application/json;charset=utf-8" }[format];
      const fileDate = new Date(Date.parse(input.from) + 3 * 3_600_000).toISOString().slice(0, 10);
      return new Response(Uint8Array.from(bytes).buffer as ArrayBuffer, { headers: {
        "Content-Type": contentType, "Content-Disposition": `attachment; filename="yonetici-motor-kararlari-${fileDate}.${format}"`,
        "Cache-Control": "no-store", "X-Decision-Count": String(report.items.length),
      } });
    } catch (error) {
      if (error instanceof DecisionReportError) return Response.json({ error: error.message }, { status: error.status });
      if (error instanceof SyntaxError) return Response.json({ error: "Rapor isteği veya karar verisi okunamadı. Eksik çıktı oluşturulmadı." }, { status: 400 });
      logger.error("reports.decision_report_failed", error);
      return Response.json({ error: "Yönetici raporu oluşturulamadı. Lütfen tekrar deneyin." }, { status: 503 });
    }
  };
}
