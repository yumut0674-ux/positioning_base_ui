export const LOCATION_TIMEZONE = "Europe/Istanbul" as const;
/** @deprecated Legacy fallback for records created before map-aware tracking. */
export const FLOOR_PLAN_ID = "hq-l1" as const;

export type DataStatus = "complete" | "partial" | "no_data" | "stale" | "ambiguous";

export type LocationErrorCode =
  | "VALIDATION_ERROR"
  | "ENTITY_NOT_FOUND"
  | "ENTITY_AMBIGUOUS"
  | "TAG_ASSIGNMENT_NOT_FOUND"
  | "LOCATION_NOT_FOUND"
  | "INVALID_DATE_RANGE"
  | "DATE_RANGE_TOO_LARGE"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface ResponseMeta {
  readonly timezone: typeof LOCATION_TIMEZONE;
  readonly generatedAt: string;
  readonly dataStatus: DataStatus;
  readonly warnings: readonly string[];
}

export interface SuccessEnvelope<T> {
  readonly data: T;
  readonly meta: ResponseMeta;
}

export interface ErrorEnvelope {
  readonly error: {
    readonly code: LocationErrorCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly details: Readonly<Record<string, unknown>>;
  };
  readonly meta: ResponseMeta;
}

export type ApiEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export interface EntityMatch {
  readonly entityId: number;
  readonly entityCode: string;
  readonly name: string;
  readonly entityType: string;
  readonly tagCode: string | null;
  readonly status: string;
}

export interface TrackedEntity extends Omit<EntityMatch, "tagCode"> {
  readonly aliases: readonly string[];
  readonly usesLegacyTagModel: boolean;
}

export interface TagAssignment {
  readonly entityId: number;
  readonly tagCode: string;
  readonly assignedAt: string;
  readonly unassignedAt: string | null;
  readonly usesLegacyTagModel: boolean;
}

export interface PositionRecord {
  readonly pdop?: number | null;
  readonly decision?: import("../regionEngine/types").ProcessedPosition;
  readonly tagCode: string;
  readonly x: number;
  readonly y: number;
  readonly observedAt: string;
  readonly gapBeforeSeconds: number | null;
  readonly mapId?: string | null;
  readonly sourceZoneId?: string | null;
  readonly sourceZoneName?: string | null;
}

export interface ResolvedPosition {
  readonly pdop?: number | null;
  readonly roomDecision?: import("../regionEngine/types").ProcessedPosition["regionInference"];
  readonly rawPosition?: { readonly x: number; readonly y: number; readonly pdop?: number | null; readonly timestamp: string };
  readonly publishedAt?: string;
  readonly engineVersion?: string;
  readonly configVersion?: string;
  readonly x: number;
  readonly y: number;
  readonly zoneName: string;
  readonly floorPlanId: string | null;
  readonly mapId?: string | null;
  readonly sourceZoneId?: string | null;
  readonly sourceZoneName?: string | null;
}

export interface SearchEntitiesData {
  readonly matches: readonly EntityMatch[];
}

export type TrackingStatus = "live" | "stale" | "offline" | "unknown";

export interface CurrentLocationData {
  readonly entityId: number;
  readonly entityName: string;
  readonly tagCode: string;
  readonly position: ResolvedPosition;
  readonly observedAt: string;
  readonly ageSeconds: number;
  readonly trackingStatus: TrackingStatus;
}

export interface LocationAtTimeData {
  readonly entityId: number;
  readonly requestedAt: string;
  readonly observedAt: string | null;
  readonly differenceSeconds: number | null;
  readonly position: ResolvedPosition | null;
  readonly tagCode: string | null;
}

export type HistoryFormat = "zone_timeline" | "route_points";

export interface RoutePoint extends ResolvedPosition {
  readonly x: number;
  readonly y: number;
  readonly observedAt: string;
  readonly zoneName: string;
  readonly floorPlanId: string | null;
  readonly tagCode: string;
}

export interface ZoneTimelineEntry {
  /** Legacy time field names denote decision intervals, not exact physical crossing times. */
  readonly timeMeaning?: "decision_effective_at";
  readonly zoneName: string;
  readonly enteredAt: string;
  readonly exitedAt: string;
  readonly durationSeconds: number;
  readonly mapId?: string | null;
  readonly floorPlanId?: string | null;
  readonly sourceZoneId?: string | null;
}

export interface DataGap {
  readonly after: string;
  readonly before: string;
  readonly durationSeconds: number;
}

export interface RoutePointsHistoryData {
  readonly zoneTimeline?: readonly ZoneTimelineEntry[];
  readonly entityId: number;
  readonly entityName: string;
  readonly from: string;
  readonly to: string;
  readonly format: "route_points";
  readonly points: readonly RoutePoint[];
  readonly gaps: readonly DataGap[];
  readonly returnedCount: number;
  readonly sampled: boolean;
  readonly sourcePointCount: number;
}

export interface ZoneTimelineHistoryData {
  readonly entityId: number;
  readonly entityName: string;
  readonly timeline: readonly ZoneTimelineEntry[];
}

export type LocationHistoryData = RoutePointsHistoryData | ZoneTimelineHistoryData;

export interface HistoryQuery {
  readonly entityId: number;
  readonly from: string;
  readonly to: string;
  readonly format: HistoryFormat;
  readonly limit: number;
  readonly mapId?: string;
}

export function toIstanbulIso(value: Date | string): string {
  const instant = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new TypeError("Invalid date value");
  const shifted = new Date(instant.getTime() + 3 * 60 * 60 * 1_000);
  return shifted.toISOString().replace("Z", "+03:00");
}

export function createMeta(
  dataStatus: DataStatus,
  warnings: readonly string[] = [],
  now: () => Date = () => new Date(),
): ResponseMeta {
  return {
    timezone: LOCATION_TIMEZONE,
    generatedAt: toIstanbulIso(now()),
    dataStatus,
    warnings,
  };
}

export function successEnvelope<T>(
  data: T,
  dataStatus: DataStatus = "complete",
  warnings: readonly string[] = [],
  now?: () => Date,
): SuccessEnvelope<T> {
  return { data, meta: createMeta(dataStatus, warnings, now) };
}

export function errorEnvelope(
  code: LocationErrorCode,
  message: string,
  retryable: boolean,
  details: Readonly<Record<string, unknown>> = {},
  now?: () => Date,
): ErrorEnvelope {
  return {
    error: { code, message, retryable, details },
    meta: createMeta("no_data", [], now),
  };
}

export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return typeof value === "object" && value !== null && "error" in value;
}
