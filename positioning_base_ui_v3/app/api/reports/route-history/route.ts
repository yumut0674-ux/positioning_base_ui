import { logger } from "@/src/server/logger";
import { createRouteReportPdf } from "@/src/server/reports/routeReportPdf";
import { listRouteReportRooms } from "@/src/server/reports/routeReportRooms";
import { loadRouteReport, RouteReportError, validateRouteReportRequest } from "@/src/server/reports/routeReportService";
import { systemSettings } from "@/src/server/settings/systemSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ rooms: await listRouteReportRooms() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("reports.route_history_rooms_failed", error);
    return Response.json({ error: "Oda listesi yüklenemedi." }, { status: 503 });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const input = validateRouteReportRequest(await request.json());
    const report = await loadRouteReport(input);
    const settings = await systemSettings.read(true);
    const pdf = await createRouteReportPdf(report, settings.reports.routeHistoryMinDurationMs);
    return new Response(Uint8Array.from(pdf).buffer as ArrayBuffer, { headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="rota-gecmisi-${new Date().toISOString().slice(0, 10)}.pdf"`,
      "Cache-Control": "no-store",
    } });
  } catch (error) {
    if (error instanceof RouteReportError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return Response.json({ error: "Rapor seçimleri okunamadı." }, { status: 400 });
    logger.error("reports.route_history_failed", error);
    return Response.json({ error: "PDF raporu oluşturulamadı. Lütfen tekrar deneyin." }, { status: 503 });
  }
}
