import type { DecisionLogFilters, DecisionLogListResponse } from "../../features/decisionLogs/types/decisionLog.types";
import { encodeDecisionCursor, roomDecisions } from "../location/roomDecisionRepository";
import { notifications } from "./notificationRepository";

type LogSource = { list(filters: DecisionLogFilters): Promise<DecisionLogListResponse> };
export async function listAnalysisLogs(filters: DecisionLogFilters, rooms: LogSource = roomDecisions, alerts: LogSource = notifications): Promise<DecisionLogListResponse> {
  if (filters.eventType === "NOTIFICATION") return alerts.list(filters);
  if (filters.eventType) return rooms.list(filters);
  const [roomPage, alertPage] = await Promise.all([rooms.list(filters), alerts.list(filters)]);
  const sorted = [...roomPage.items, ...alertPage.items].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || b.decisionId.localeCompare(a.decisionId));
  const items = sorted.slice(0, filters.limit);
  const hasMore = sorted.length > filters.limit || roomPage.nextCursor || alertPage.nextCursor;
  return { items, nextCursor: hasMore && items.length ? encodeDecisionCursor({ publishedAt: items.at(-1)!.publishedAt, key: items.at(-1)!.decisionId }) : null,
    metadata: { filteredCount: roomPage.metadata.filteredCount + alertPage.metadata.filteredCount, returnedCount: items.length,
      countAccuracy: roomPage.metadata.countAccuracy === "exact" && alertPage.metadata.countAccuracy === "exact" ? "exact" : "estimated" } };
}
