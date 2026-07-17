import { resolveLocation } from "@/src/features/map/services/LocationResolverService";

export interface HistoricalPosition {
  readonly tagId: string;
  readonly x: number;
  readonly y: number;
  readonly timestamp: string;
  readonly battery?: number;
}

export interface LocationStay {
  readonly id: string;
  readonly locationLabel: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly positions: readonly HistoricalPosition[];
  readonly isDataGap?: boolean;
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

function resolveStableLocations(positions: readonly HistoricalPosition[], floorPlanId: string): readonly ResolvedPosition[] {
  if (positions.length === 0) return [];

  const resolved: ResolvedPosition[] = [];
  let currentLabel = resolveLocation(positions[0].x, positions[0].y, floorPlanId);
  let candidateLabel: string | null = null;
  let candidateIndexes: number[] = [];

  positions.forEach((position, index) => {
    const rawLabel = resolveLocation(position.x, position.y, floorPlanId);
    const previousPosition = positions[index - 1];
    const hasDataGap = previousPosition && timestampOf(position) - timestampOf(previousPosition) > DATA_GAP_MS;

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

export function buildLocationTimeline(positions: readonly HistoricalPosition[], floorPlanId: string): readonly LocationStay[] {
  const chronologicalPositions = [...positions].sort((left, right) => timestampOf(left) - timestampOf(right));
  const resolved = resolveStableLocations(chronologicalPositions, floorPlanId);
  if (resolved.length === 0) return [];

  const stays: LocationStay[] = [];
  let currentPositions: HistoricalPosition[] = [resolved[0].position];
  let currentLabel = resolved[0].locationLabel;
  let startedAt = resolved[0].position.timestamp;

  const closeStay = (endedAt: string) => {
    stays.push({
      id: `stay-${stays.length}-${startedAt}`,
      locationLabel: currentLabel,
      startedAt,
      endedAt,
      durationMs: Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime()),
      positions: currentPositions,
    });
  };

  for (let index = 1; index < resolved.length; index += 1) {
    const previous = resolved[index - 1];
    const current = resolved[index];
    const gapDuration = timestampOf(current.position) - timestampOf(previous.position);

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
      });
      currentPositions = [current.position];
      currentLabel = current.locationLabel;
      startedAt = current.position.timestamp;
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
  }

  closeStay(currentPositions.at(-1)?.timestamp ?? startedAt);
  return stays;
}
