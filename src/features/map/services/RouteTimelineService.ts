import { resolveLocation } from "@/src/features/map/services/LocationResolverService";
import type { RegionsConfig } from "@/src/features/regions/types/region.types";

export interface HistoricalPosition {
  readonly tagId: string;
  readonly x: number;
  readonly y: number;
  readonly timestamp: string;
  readonly mapId?: string | null;
  readonly sourceZoneId?: string | null;
  readonly sourceZoneName?: string | null;
}

export interface LocationStay {
  readonly id: string;
  readonly locationLabel: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly positions: readonly HistoricalPosition[];
  readonly isDataGap?: boolean;
  readonly mapId?: string | null;
  readonly isMapTransition?: boolean;
}

export interface RouteSegment { readonly mapId: string | null; readonly positions: readonly HistoricalPosition[] }

export function segmentRouteByMap(positions: readonly HistoricalPosition[]): readonly RouteSegment[] {
  const result: { mapId: string | null; positions: HistoricalPosition[] }[] = [];
  for (const position of [...positions].sort((a, b) => timestampOf(a) - timestampOf(b))) {
    const mapId = position.mapId ?? null;
    const current = result.at(-1);
    if (!current || current.mapId !== mapId) result.push({ mapId, positions: [position] });
    else current.positions.push(position);
  }
  return result;
}

export function routeDistanceByMap(positions: readonly HistoricalPosition[]): number {
  return segmentRouteByMap(positions).reduce((sum, segment) => sum + segment.positions.slice(1).reduce((subtotal, position, index) => subtotal + Math.hypot(position.x - segment.positions[index].x, position.y - segment.positions[index].y), 0), 0);
}

const DATA_GAP_MS = 5 * 60 * 1_000;
const CHANGE_CONFIRMATION_MS = 20 * 1_000;

interface ResolvedPosition {
  readonly position: HistoricalPosition;
  readonly locationLabel: string;
}

function timestampOf(position: HistoricalPosition): number {
  return new Date(position.timestamp).getTime();
}

type RegionsConfigSource = RegionsConfig | Readonly<Record<string, RegionsConfig>> | null | undefined;

function isRegionsConfig(source: Exclude<RegionsConfigSource, null | undefined>): source is RegionsConfig {
  return Array.isArray((source as RegionsConfig).regions) && typeof (source as RegionsConfig).map?.mapId === "string";
}

function configForMap(source: RegionsConfigSource, mapId: string | null | undefined): RegionsConfig | null {
  if (!source || !mapId) return null;
  if (isRegionsConfig(source)) return source.map.mapId === mapId ? source : null;
  return source[mapId] ?? null;
}

function resolveStableLocations(positions: readonly HistoricalPosition[], floorPlanId: string, regionsConfig?: RegionsConfigSource): readonly ResolvedPosition[] {
  if (positions.length === 0) return [];

  const resolved: ResolvedPosition[] = [];
  const firstMapId = positions[0].mapId ?? null;
  let currentLabel = firstMapId === null ? "Kat belirlenemedi" : resolveLocation(positions[0].x, positions[0].y, firstMapId || floorPlanId, configForMap(regionsConfig, firstMapId));
  let candidateLabel: string | null = null;
  let candidateIndexes: number[] = [];

  positions.forEach((position, index) => {
    const mapId = position.mapId ?? null;
    const rawLabel = mapId === null ? "Kat belirlenemedi" : resolveLocation(position.x, position.y, mapId || floorPlanId, configForMap(regionsConfig, mapId));
    const previousPosition = positions[index - 1];
    const hasDataGap = previousPosition && (timestampOf(position) - timestampOf(previousPosition) > DATA_GAP_MS || previousPosition.mapId !== position.mapId);

    if (index === 0 || hasDataGap) {
      currentLabel = rawLabel;
      candidateLabel = null;
      candidateIndexes = [];
      resolved.push({ position, locationLabel: currentLabel });
      return;
    }

    resolved.push({ position, locationLabel: currentLabel });
    if (rawLabel === currentLabel) {
      candidateLabel = null;
      candidateIndexes = [];
      return;
    }

    if (rawLabel !== candidateLabel) {
      candidateLabel = rawLabel;
      candidateIndexes = [resolved.length - 1];
      return;
    }

    candidateIndexes.push(resolved.length - 1);
    const candidateStartedAt = timestampOf(resolved[candidateIndexes[0]].position);
    const isConfirmed = candidateIndexes.length >= 2 || timestampOf(position) - candidateStartedAt >= CHANGE_CONFIRMATION_MS;
    if (!isConfirmed) return;

    currentLabel = rawLabel;
    candidateIndexes.forEach((candidateIndex) => {
      const candidate = resolved[candidateIndex];
      resolved[candidateIndex] = { ...candidate, locationLabel: currentLabel };
    });
    candidateLabel = null;
    candidateIndexes = [];
  });

  return resolved;
}

export function buildLocationTimeline(positions: readonly HistoricalPosition[], floorPlanId: string, regionsConfig?: RegionsConfigSource): readonly LocationStay[] {
  const chronologicalPositions = [...positions].sort((left, right) => timestampOf(left) - timestampOf(right));
  const resolved = resolveStableLocations(chronologicalPositions, floorPlanId, regionsConfig);
  if (resolved.length === 0) return [];

  const stays: LocationStay[] = [];
  let currentPositions: HistoricalPosition[] = [resolved[0].position];
  let currentLabel = resolved[0].locationLabel;
  let startedAt = resolved[0].position.timestamp;
  let currentIsMapTransition = false;

  const closeStay = (endedAt: string) => {
    stays.push({
      id: `stay-${stays.length}-${startedAt}`,
      locationLabel: currentLabel,
      startedAt,
      endedAt,
      durationMs: Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime()),
      positions: currentPositions,
      mapId: currentPositions[0]?.mapId ?? null,
      isMapTransition: currentIsMapTransition,
    });
  };

  for (let index = 1; index < resolved.length; index += 1) {
    const previous = resolved[index - 1];
    const current = resolved[index];
    const gapDuration = timestampOf(current.position) - timestampOf(previous.position);
    const mapChanged = (previous.position.mapId ?? null) !== (current.position.mapId ?? null);

    if (gapDuration > DATA_GAP_MS) {
      closeStay(previous.position.timestamp);
      stays.push({
        id: `gap-${stays.length}-${previous.position.timestamp}`,
        locationLabel: "Konum verisi alınamadı",
        startedAt: previous.position.timestamp,
        endedAt: current.position.timestamp,
        durationMs: gapDuration,
        positions: [],
        isDataGap: true,
        mapId: null,
        isMapTransition: previous.position.mapId !== current.position.mapId,
      });
      currentPositions = [current.position];
      currentLabel = current.locationLabel;
      startedAt = current.position.timestamp;
      currentIsMapTransition = mapChanged;
      continue;
    }

    if (mapChanged) {
      closeStay(previous.position.timestamp);
      currentPositions = [current.position];
      currentLabel = current.locationLabel;
      startedAt = current.position.timestamp;
      currentIsMapTransition = true;
      continue;
    }

    if (current.locationLabel === currentLabel) {
      currentPositions.push(current.position);
      continue;
    }

    closeStay(current.position.timestamp);
    currentPositions = [current.position];
    currentLabel = current.locationLabel;
    startedAt = current.position.timestamp;
    currentIsMapTransition = false;
  }

  closeStay(currentPositions.at(-1)?.timestamp ?? startedAt);
  return stays;
}
