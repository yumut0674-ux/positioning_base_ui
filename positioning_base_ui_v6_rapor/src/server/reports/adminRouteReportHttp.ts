import { logger } from "../logger";
import { DecisionReportError, validateDecisionReportRequest } from "./decisionReportRequest";
import { loadAdminRouteReport } from "./adminRouteReportService";
import { adminRouteCsv, createAdminRoutePdf, createAdminRouteXlsx } from "./adminRouteReportFormats";

export function createAdminRouteReportHandler(load = loadAdminRouteReport, now = () => new Date()) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const generatedAt = now(), input = validateDecisionReportRequest(await request.json(), generatedAt);
      const report = await load(input, generatedAt);
      const bytes = input.format === "pdf" ? await createAdminRoutePdf(report) : input.format === "xlsx" ? createAdminRouteXlsx(report)
        : Buffer.from(input.format === "csv" ? adminRouteCsv(report) : JSON.stringify(report, null, 2), "utf8");
      const type = { pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv;charset=utf-8", json: "application/json;charset=utf-8" }[input.format];
      const date = new Date(Date.parse(input.from) + 3 * 3_600_000).toISOString().slice(0, 10);
      return new Response(Uint8Array.from(bytes).buffer as ArrayBuffer, { headers: { "Content-Type": type,
        "Content-Disposition": `attachment; filename="yonetici-oda-koridor-${date}.${input.format}"`, "Cache-Control": "no-store", "X-Interval-Count": String(report.rows.length) } });
    } catch (error) {
      if (error instanceof DecisionReportError) return Response.json({ error: error.message }, { status: error.status });
      if (error instanceof SyntaxError) return Response.json({ error: "Rapor isteği okunamadı." }, { status: 400 });
      logger.error("reports.admin_route_failed", error);
      return Response.json({ error: "Yönetici oda ve koridor raporu oluşturulamadı." }, { status: 503 });
    }
  };
}
