import { queryPostgres, type PgRow } from "../postgresClient";
import type { ProcessedPosition } from "../regionEngine/types";
import type { AdminRouteReportData, AdminRouteReportRequest } from "../../features/reports/types/adminRouteReport.types";
import { DecisionReportError, MAX_DECISION_REPORT_RECORDS } from "./decisionReportRequest";
import { listRouteReportRooms, type RouteReportRoom } from "./routeReportRooms";
import { buildAdminRouteRows, type StoredRouteDecision } from "./adminRouteReport";

const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
interface Sources {
  readonly query?: (sql: string) => Promise<PgRow[]>;
  readonly rooms?: () => Promise<readonly RouteReportRoom[]>;
}

/** Read only stored decisions. No ingest, tick, flush, settings or live repository calls. */
export async function loadAdminRouteReport(input: AdminRouteReportRequest, now = new Date(), sources: Sources = {}): Promise<AdminRouteReportData> {
  const query = sources.query ?? queryPostgres;
  const tagScope = input.tagCode ? ` AND strpos(upper(d.tag_code),${quote(input.tagCode.toUpperCase())})>0` : "";
  const fields = `d.id::text,d.event_id,d.tag_code,d.published_at::text,d.payload::text,COALESCE(t.display_name,t.tag_name,d.tag_code) tag_name`;
  // Read all intervening states, including candidates/rejections and other rooms/maps.
  const rows = await query(`SELECT ${fields} FROM tag_room_decisions d LEFT JOIN tags t ON t.tag_code=d.tag_code
    WHERE d.published_at>=${quote(input.from)}::timestamptz AND d.published_at<=${quote(input.to)}::timestamptz${tagScope}
    ORDER BY d.published_at,d.id LIMIT ${MAX_DECISION_REPORT_RECORDS + 1};`);
  if (rows.length > MAX_DECISION_REPORT_RECORDS) throw new DecisionReportError("Rapor 50.000 kaynak kayıt sınırını aşıyor. Tarih aralığını daraltın veya tek tag seçin. Eksik çıktı oluşturulmadı.", 422);
  const seeds = await query(`SELECT DISTINCT ON (d.tag_code) ${fields} FROM tag_room_decisions d LEFT JOIN tags t ON t.tag_code=d.tag_code
    WHERE d.published_at<${quote(input.from)}::timestamptz${tagScope}
    ORDER BY d.tag_code,d.published_at DESC,d.id DESC LIMIT ${MAX_DECISION_REPORT_RECORDS + 1};`);
  if (rows.length + seeds.length > MAX_DECISION_REPORT_RECORDS) throw new DecisionReportError("Rapor 50.000 kaynak kayıt sınırını aşıyor. Tarih aralığını daraltın veya tek tag seçin. Eksik çıktı oluşturulmadı.", 422);
  const decisions: StoredRouteDecision[] = [...seeds, ...rows].map(row => {
    let position: ProcessedPosition;
    try {
      position = JSON.parse(row.payload!) as ProcessedPosition;
      if (!position?.regionInference || typeof position.regionInference !== "object" || !row.tag_code || !Number.isFinite(Date.parse(row.published_at ?? ""))) throw new Error("invalid decision");
    } catch { throw new DecisionReportError(`Konum kaydı okunamadı (ID: ${row.event_id ?? row.id}). Eksik çıktı oluşturulmadı.`, 503); }
    return { position: { ...position, tagCode: row.tag_code!, publishedAt: new Date(row.published_at!).toISOString() }, tagName: row.tag_name ?? row.tag_code! };
  });
  const rooms = await (sources.rooms ?? listRouteReportRooms)().catch(() => [] as readonly RouteReportRoom[]);
  const reportRows = buildAdminRouteRows(input, decisions, rooms);
  if (!reportRows.length) throw new DecisionReportError("Seçilen aralıkta raporlanacak konum kaydı bulunamadı.", 422);
  return { from: input.from, to: input.to, generatedAt: now.toISOString(), timezone: "Europe/Istanbul",
    filters: { ...(input.tagCode ? { tagCode: input.tagCode } : {}), ...(input.mapId ? { mapId: input.mapId } : {}), ...(input.regionId ? { regionId: input.regionId } : {}) }, rows: reportRows };
}
