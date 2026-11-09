import { readFile } from "node:fs/promises";
import path from "node:path";
import { queryPostgres } from "../postgresClient";
import { decodeDecisionCursor, encodeDecisionCursor } from "../location/roomDecisionRepository";
import type { DecisionLogDetail, DecisionLogFilters, DecisionLogListResponse } from "../../features/decisionLogs/types/decisionLog.types";
import { notificationMessage, type AreaExitNotification } from "../../features/notifications/notification.types";

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
export function projectNotification(item: AreaExitNotification): DecisionLogDetail {
  return {
    decisionId: item.id, tagCode: item.tagCode, eventType: "NOTIFICATION", severity: "warning",
    measuredAt: item.exitedAt, publishedAt: item.createdAt, mapId: item.mapId,
    regionId: item.areaId, regionName: item.areaName,
    reasonCodes: ["AREA_EXIT_NOTIFICATION"], shortReason: notificationMessage(item),
    engineVersion: "notification-observer-v1", configVersion: "1", payload: { ...item }, notification: item,
  };
}

export class NotificationRepository {
  private ready?: Promise<void>;
  public constructor(private readonly query = queryPostgres) {}
  public async ensureSchema(): Promise<void> {
    this.ready ??= readFile(path.join(process.cwd(), "drizzle", "0011_area_exit_notifications.sql"), "utf8")
      .then(sql => this.query(sql)).then(() => undefined).catch(error => { this.ready = undefined; throw error; });
    await this.ready;
  }
  public async save(items: readonly AreaExitNotification[]): Promise<void> {
    if (!items.length) return;
    await this.ensureSchema();
    await this.query(`INSERT INTO area_exit_notifications(notification_id,tag_code,map_id,area_id,created_at,payload) VALUES ${items.map(item =>
      `(${quote(item.id)},${quote(item.tagCode)},${quote(item.mapId)},${item.areaId ? quote(item.areaId) : "NULL"},${quote(item.createdAt)}::timestamptz,${quote(JSON.stringify(item))}::jsonb)`
    ).join(",")} ON CONFLICT(notification_id) DO NOTHING;`);
  }
  public async definitions() {
    await this.ensureSchema();
    return this.query("SELECT tag_code,COALESCE(display_name,tag_name,tag_code) AS name,area_exit_notification_enabled::text AS enabled FROM tags;");
  }
  public async list(filters: DecisionLogFilters): Promise<DecisionLogListResponse> {
    await this.ensureSchema();
    if ((filters.eventType && filters.eventType !== "NOTIFICATION") || filters.state || filters.measurementKind
      || (filters.engineVersion && filters.engineVersion !== "notification-observer-v1") || (filters.configVersion && filters.configVersion !== "1")) {
      return { items: [], nextCursor: null, metadata: { filteredCount: 0, returnedCount: 0, countAccuracy: "exact" } };
    }
    const where = [`created_at>=${quote(filters.from)}::timestamptz`, `created_at<=${quote(filters.to)}::timestamptz`];
    if (filters.tagCode) where.push(`tag_code ILIKE ${quote(`%${filters.tagCode}%`)}`);
    if (filters.mapId) where.push(`map_id=${quote(filters.mapId)}`);
    if (filters.regionId) where.push(`area_id=${quote(filters.regionId)}`);
    const cursor = filters.cursor ? decodeDecisionCursor(filters.cursor) : null;
    const pageWhere = cursor ? `WHERE (created_at,notification_id)<(${quote(cursor.publishedAt)}::timestamptz,${quote(cursor.key)})` : "";
    const rows = await this.query(`WITH filtered AS (SELECT * FROM area_exit_notifications WHERE ${where.join(" AND ")}),
      stats AS (SELECT count(*)::text AS total FROM filtered),
      page AS (SELECT * FROM filtered ${pageWhere} ORDER BY created_at DESC,notification_id DESC LIMIT ${filters.limit + 1})
      SELECT page.payload::text,stats.total FROM stats LEFT JOIN page ON TRUE ORDER BY page.created_at DESC,page.notification_id DESC;`);
    const values = rows.filter(row => row.payload).map(row => projectNotification(JSON.parse(row.payload!) as AreaExitNotification));
    const items = values.slice(0, filters.limit);
    return { items, nextCursor: values.length > filters.limit ? encodeDecisionCursor({ publishedAt: items.at(-1)!.publishedAt, key: items.at(-1)!.decisionId }) : null,
      metadata: { filteredCount: Number(rows[0]?.total ?? 0), returnedCount: items.length, countAccuracy: "exact" } };
  }
  public async detail(id: string): Promise<DecisionLogDetail | null> {
    await this.ensureSchema();
    const [row] = await this.query(`SELECT payload::text FROM area_exit_notifications WHERE notification_id=${quote(id)};`);
    return row?.payload ? projectNotification(JSON.parse(row.payload) as AreaExitNotification) : null;
  }
  public async active(now: number): Promise<AreaExitNotification[]> {
    await this.ensureSchema();
    const rows = await this.query(`SELECT payload::text FROM area_exit_notifications
      WHERE created_at>=${quote(new Date(now - 86_400_000).toISOString())}::timestamptz
      AND created_at + (payload->>'displayDurationMs')::bigint * INTERVAL '1 millisecond' > ${quote(new Date(now).toISOString())}::timestamptz
      ORDER BY created_at DESC,notification_id DESC;`);
    return rows.map(row => JSON.parse(row.payload!) as AreaExitNotification);
  }
}
export const notifications = new NotificationRepository();
