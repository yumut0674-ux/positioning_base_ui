import type { Point2D } from "@/src/shared/types/geometry";

export interface TagTrailPoint extends Point2D {
  readonly at: number;
  readonly segment: number;
  readonly source: "RAW" | "REGION_CENTER";
}

const MINIMUM_TRAIL_MOVEMENT_METERS = 0.03;
const TRAIL_BREAK_DISTANCE_METERS = 2;
const MAXIMUM_TRAIL_POINTS = 100;

export function pruneTagTrail(points: readonly TagTrailPoint[], now: number, durationMs: number): TagTrailPoint[] {
  const cutoff = now - durationMs;
  return points.filter((point) => point.at >= cutoff).slice(-MAXIMUM_TRAIL_POINTS);
}

export function appendTagTrailPoint(
  points: readonly TagTrailPoint[],
  sample: Point2D & { readonly source?: "RAW" | "REGION_CENTER" },
  now: number,
  durationMs: number,
): TagTrailPoint[] {
  const retained = pruneTagTrail(points, now, durationMs);
  const source = sample.source ?? "RAW";
  const previous = retained.at(-1);
  if (previous && previous.x === sample.x && previous.y === sample.y && previous.source === source) return retained;

  const movement = previous ? Math.hypot(sample.x - previous.x, sample.y - previous.y) : Number.POSITIVE_INFINITY;
  if (previous && source === "RAW" && previous.source === "RAW" && movement < MINIMUM_TRAIL_MOVEMENT_METERS) return retained;

  const startsNewSegment = Boolean(previous) && (
    source !== "RAW"
    || previous!.source !== "RAW"
    || movement > TRAIL_BREAK_DISTANCE_METERS
  );
  const point: TagTrailPoint = {
    x: sample.x,
    y: sample.y,
    at: now,
    source,
    segment: previous ? previous.segment + (startsNewSegment ? 1 : 0) : 0,
  };
  return [...retained, point].slice(-MAXIMUM_TRAIL_POINTS);
}
