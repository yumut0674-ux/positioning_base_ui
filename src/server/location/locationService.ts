import { resolveLocation } from "../../features/map/services/LocationResolverService";
import type { EntityRepository } from "./entityRepository";
import { EntityService } from "./entityService";
import { LocationError } from "./locationErrors";
import type { PositionRepository } from "./positionRepository";
import type { RoomDecisionRepository } from "./roomDecisionRepository";
import { ageDecision, decisionZone, projectHistory, projectDecisionTimeline } from "./roomDecisionProjection";
import {
  successEnvelope,
  type CurrentLocationData, type DataGap, type HistoryQuery, type LocationAtTimeData,
  type LocationHistoryData, type PositionRecord, type RoutePoint, type RoutePointsHistoryData,
  type SuccessEnvelope, type TrackingStatus, type ZoneTimelineEntry, type ZoneTimelineHistoryData,
} from "./location.types";

type ZoneResolver = (x: number, y: number, floorPlanId: string) => string;

function envInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function resolvedPosition(record: PositionRecord, zoneResolver: ZoneResolver) {
  if (record.decision) {
    const d = record.decision;
    const mapId = d.mapId ?? record.mapId ?? null;
    return { x: d.x, y: d.y, pdop: d.pdop ?? null, zoneName: decisionZone(d), floorPlanId: mapId, mapId, sourceZoneId: d.sourceZoneId ?? record.sourceZoneId ?? null, sourceZoneName: d.sourceZoneName ?? record.sourceZoneName ?? null, roomDecision: d.regionInference,
      rawPosition: d.rawPosition, publishedAt: d.publishedAt, engineVersion: d.engineVersion, configVersion: d.configVersion };
  }
  return {
    x: record.x, y: record.y, pdop: record.pdop ?? null, zoneName: record.mapId ? zoneResolver(record.x, record.y, record.mapId) : "Kat belirlenemedi",
    floorPlanId: record.mapId ?? null, mapId: record.mapId ?? null, sourceZoneId: record.sourceZoneId ?? null, sourceZoneName: record.sourceZoneName ?? null,
  } as const;
}

function trackingStatus(ageSeconds: number, liveThreshold: number, offlineThreshold: number): TrackingStatus {
  if (ageSeconds <= liveThreshold) return "live";
  if (ageSeconds <= offlineThreshold) return "stale";
  return "offline";
}

function buildGaps(positions: readonly PositionRecord[]): readonly DataGap[] {
  return positions.flatMap((position, index) => {
    const previous = positions[index - 1];
    if (!previous || position.gapBeforeSeconds === null || position.gapBeforeSeconds <= 300) return [];
    return [{ after: previous.observedAt, before: position.observedAt, durationSeconds: Math.round(position.gapBeforeSeconds) }];
  });
}

function toRoutePoint(position: PositionRecord, zoneResolver: ZoneResolver): RoutePoint {
  return { ...resolvedPosition(position, zoneResolver), observedAt: position.observedAt, tagCode: position.tagCode };
}

function toTimeline(positions: readonly PositionRecord[], zoneResolver: ZoneResolver): readonly ZoneTimelineEntry[] {
  const entries: ZoneTimelineEntry[] = [];
  const chronological = [...positions].sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
  for (const position of chronological) {
    const resolvedValue = resolvedPosition(position, zoneResolver);
    const zoneName = resolvedValue.zoneName;
    const previous = entries.at(-1);
    const actualGapSeconds = previous
      ? Math.max(0, (Date.parse(position.observedAt) - Date.parse(previous.exitedAt)) / 1_000)
      : 0;
    const isGap = !position.decision && (position.gapBeforeSeconds ?? actualGapSeconds) > 300;
    if (!previous || isGap) {
      entries.push({
        zoneName, mapId: resolvedValue.mapId, floorPlanId: resolvedValue.mapId, sourceZoneId: resolvedValue.sourceZoneId, enteredAt: position.observedAt, exitedAt: position.observedAt, durationSeconds: 0,
      });
      continue;
    }
    if (previous.zoneName !== zoneName || previous.mapId !== resolvedValue.mapId) {
      entries[entries.length - 1] = {
        ...previous,
        exitedAt: position.observedAt,
        durationSeconds: Math.max(0, Math.round((Date.parse(position.observedAt) - Date.parse(previous.enteredAt)) / 1_000)),
      };
      entries.push({ zoneName, mapId: resolvedValue.mapId, floorPlanId: resolvedValue.mapId, sourceZoneId: resolvedValue.sourceZoneId, enteredAt: position.observedAt, exitedAt: position.observedAt, durationSeconds: 0 });
      continue;
    }
    entries[entries.length - 1] = {
      ...previous,
      exitedAt: position.observedAt,
      durationSeconds: Math.max(0, Math.round((Date.parse(position.observedAt) - Date.parse(previous.enteredAt)) / 1_000)),
    };
  }
  return entries;
}

export class LocationService {
  private readonly entityService: EntityService;

  public constructor(
    private readonly entities: EntityRepository,
    private readonly positions: PositionRepository,
    private readonly zoneResolver: ZoneResolver = resolveLocation,
    private readonly decisions?: RoomDecisionRepository,
  ) {
    this.entityService = new EntityService(entities);
  }

  public async current(entityId: number, now: () => Date = () => new Date()): Promise<SuccessEnvelope<CurrentLocationData>> {
    const entity = await this.entityService.requireEntity(entityId);
    const assignment = await this.entities.getAssignmentAt(entityId, now().toISOString());
    if (!assignment) throw new LocationError("TAG_ASSIGNMENT_NOT_FOUND", { details: { entityId } });
    let position = await this.positions.latest(assignment.tagCode);
    const decision = await this.decisions?.latest(assignment.tagCode, now().toISOString());
    if (decision && Date.parse(decision.lastRawDataTimestamp) >= Date.parse(assignment.assignedAt) && (!position || Date.parse(position.observedAt) <= Date.parse(decision.lastRawDataTimestamp))) position = { tagCode: decision.tagCode, x: decision.rawPosition?.x ?? decision.x, y: decision.rawPosition?.y ?? decision.y, observedAt: decision.lastRawDataTimestamp, gapBeforeSeconds: null, decision: ageDecision(decision, now().toISOString()) };
    if (!position) throw new LocationError("LOCATION_NOT_FOUND", { details: { entityId } });
    const ageSeconds = Math.max(0, Math.floor((now().getTime() - Date.parse(position.observedAt)) / 1_000));
    const liveThreshold = envInteger("UWB_LIVE_THRESHOLD_SECONDS", 30, 1, 3_600);
    const offlineThreshold = envInteger("UWB_OFFLINE_THRESHOLD_SECONDS", 300, liveThreshold, 86_400);
    const status = trackingStatus(ageSeconds, liveThreshold, offlineThreshold);
    const warnings = this.entityService.warningsFor(entity);
    return successEnvelope({
      entityId, entityName: entity.name, tagCode: assignment.tagCode, position: resolvedPosition(position, this.zoneResolver),
      observedAt: position.observedAt, ageSeconds, trackingStatus: status,
    }, position.decision?.regionInference.measurementKind === "uncertain" ? "ambiguous" : status === "live" ? (warnings.length ? "partial" : "complete") : "stale", warnings, now);
  }

  public async lastKnownRoom(entityId: number, now: () => Date = () => new Date()): Promise<{ zoneName: string; observedAt: string } | null> {
    await this.entityService.requireEntity(entityId);
    const at = now().toISOString();
    const assignments = await this.entities.getAssignmentsInRange(entityId, "1970-01-01T00:00:00.000Z", at);
    const decision = await this.decisions?.latestMeasuredRoom(assignments, at);
    if (!decision?.regionInference.regionId) return null;
    return {
      zoneName: decision.regionInference.regionName ?? decision.regionInference.regionId,
      observedAt: decision.lastRawDataTimestamp,
    };
  }

  public async atTime(
    entityId: number, at: string, toleranceSeconds: number, now?: () => Date,
  ): Promise<SuccessEnvelope<LocationAtTimeData>> {
    const entity = await this.entityService.requireEntity(entityId);
    const assignment = await this.entities.getAssignmentAt(entityId, at);
    if (!assignment) throw new LocationError("TAG_ASSIGNMENT_NOT_FOUND", { details: { entityId } });
    let position = await this.positions.nearest(assignment.tagCode, at, toleranceSeconds);
    const decision = await this.decisions?.latest(assignment.tagCode, at);
    if (decision && Date.parse(decision.lastRawDataTimestamp) >= Date.parse(assignment.assignedAt)) position = { tagCode: decision.tagCode, x: decision.x, y: decision.y, observedAt: decision.lastRawDataTimestamp, gapBeforeSeconds: null, decision: ageDecision(decision, at) };
    const warnings = this.entityService.warningsFor(entity);
    if (!position) {
      return successEnvelope({
        entityId, requestedAt: at, observedAt: null, differenceSeconds: null, position: null, tagCode: assignment.tagCode,
      }, "no_data", warnings, now);
    }
    return successEnvelope({
      entityId, requestedAt: at, observedAt: position.observedAt,
      differenceSeconds: Math.abs(Math.round((Date.parse(position.observedAt) - Date.parse(at)) / 1_000)),
      position: resolvedPosition(position, this.zoneResolver), tagCode: assignment.tagCode,
    }, position.decision?.regionInference.measurementKind === "uncertain" ? "ambiguous" : warnings.length ? "partial" : "complete", warnings, now);
  }

  public async history(query: HistoryQuery, now?: () => Date): Promise<SuccessEnvelope<LocationHistoryData>> {
    const fromTime = Date.parse(query.from);
    const toTime = Date.parse(query.to);
    if (fromTime >= toTime) throw new LocationError("INVALID_DATE_RANGE");
    const maxDays = envInteger("UWB_HISTORY_MAX_DAYS", 7, 1, 31);
    if (toTime - fromTime > maxDays * 86_400_000) {
      throw new LocationError("DATE_RANGE_TOO_LARGE", { details: { maxDays } });
    }
    const entity = await this.entityService.requireEntity(query.entityId);
    const assignments = await this.entities.getAssignmentsInRange(query.entityId, query.from, query.to);
    if (assignments.length === 0) throw new LocationError("TAG_ASSIGNMENT_NOT_FOUND", { details: { entityId: query.entityId } });
    const warnings = [...this.entityService.warningsFor(entity)];
    const decisionHistory = (await this.decisions?.history(assignments.map(a => a.tagCode), query.from, query.to, 100000) ?? []).filter(d => assignments.some(a =>
      a.tagCode === d.tagCode && Date.parse(d.lastRawDataTimestamp) >= Date.parse(a.assignedAt) && (!a.unassignedAt || Date.parse(d.publishedAt!) < Date.parse(a.unassignedAt))));
    if (decisionHistory.length >= 100000) warnings.push("Oda karar geçmişi işlem sınırına ulaştı; sonuç kısmi.");
    if (query.format === "route_points") {
      const configuredMax = envInteger("UWB_HISTORY_MAX_POINTS", 2_000, 1, 2_000);
      const result = await this.positions.history(assignments, query.from, query.to, Math.min(query.limit, configuredMax), query.mapId);
      const sampled = result.sourcePointCount > result.positions.length;
      if (sampled) warnings.push(`Sonuç ${result.sourcePointCount} kayıttan güvenli biçimde ${result.positions.length} noktaya örneklendi.`);
      const data: RoutePointsHistoryData = {
        entityId: query.entityId,
        entityName: entity.name,
        from: query.from,
        to: query.to,
        format: "route_points",
        points: projectHistory(result.positions, decisionHistory, false).map((position) => toRoutePoint(position, this.zoneResolver)),
        gaps: buildGaps(result.positions),
        returnedCount: result.positions.length,
        sampled,
        sourcePointCount: result.sourcePointCount,
        ...(decisionHistory.length ? { zoneTimeline: toTimeline(projectDecisionTimeline(result.positions, decisionHistory, query.from, query.to), this.zoneResolver).slice(0, 2000).map(entry=>({...entry,timeMeaning:"decision_effective_at" as const})) } : {}),
      };
      const dataStatus = result.positions.length === 0 ? "no_data" : warnings.length ? "partial" : "complete";
      return successEnvelope(data, dataStatus, warnings, now);
    }

    const processingLimit = envInteger("UWB_HISTORY_PROCESSING_MAX_POINTS", 100_000, 1_000, 250_000);
    const result = await this.positions.timelineHistory(assignments, query.from, query.to, processingLimit, query.mapId);
    const projected = projectDecisionTimeline(result.positions, decisionHistory, query.from, query.to);
    const completeTimeline = toTimeline(projected, this.zoneResolver);
    const timeline = completeTimeline.slice(0, query.limit).map(entry=>decisionHistory.length?{...entry,timeMeaning:"decision_effective_at" as const}:entry);
    if (result.processingTruncated) {
      warnings.push(`Zone zaman çizelgesi güvenlik sınırı nedeniyle ilk ${result.positions.length} konum kaydıyla oluşturuldu.`);
    }
    if (completeTimeline.length > timeline.length) {
      warnings.push(`Zone zaman çizelgesi ${completeTimeline.length} aralıktan ${timeline.length} aralığa sınırlandı.`);
    }
    const data: ZoneTimelineHistoryData = { entityId: query.entityId, entityName: entity.name, timeline };
    const dataStatus = result.positions.length === 0 ? "no_data" : warnings.length ? "partial" : "complete";
    return successEnvelope(data, dataStatus, warnings, now);
  }
}
