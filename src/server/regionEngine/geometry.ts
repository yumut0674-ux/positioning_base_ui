import type { CompiledRegion } from "./types";

type Point = { readonly x: number; readonly y: number };
export interface DoorCrossingResult {
  readonly doorId: string; readonly direction: "entry" | "exit"; readonly occurredAt: number;
  readonly directionalMovementMeters: number; readonly evidenceWeight: number;
}

export function pointInPolygon(point: Point, region: Pick<CompiledRegion, "bounds" | "polygon">): boolean {
  const { bounds, polygon } = region;
  if (point.x < bounds.minX || point.x > bounds.maxX || point.y < bounds.minY || point.y > bounds.maxY) return false;
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    const intersects = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
}

export function wallDistance(point: Point, region: CompiledRegion): number {
  return Math.min(...region.polygon.map((end, i) => distanceToSegment(point, region.polygon[(i + region.polygon.length - 1) % region.polygon.length], end)));
}

/** Directed crossing of a defined door opening; never infer a normal from a centre. */
export function crossesDoor(from: Point, to: Point, region: CompiledRegion, inward: boolean, connectedArea?: string | null, occurredAt = Date.now()): DoorCrossingResult | null {
  for (const door of region.entrances) {
    const direction = inward ? "entry" : "exit";
    if (!door.settings.enabled || door.settings.evidenceMode === "ignored") continue;
    if (inward && door.settings.direction === "exit-only") continue;
    if (!inward && door.settings.direction === "entry-only") continue;
    if (!door.inwardNormal || !door.widthMeters || !door.connectsTo) continue;
    if (connectedArea && door.connectsTo !== connectedArea) continue;
    const n = door.inwardNormal;
    const side = (p: Point) => (p.x - door.x) * n.x + (p.y - door.y) * n.y;
    const a = side(from), b = side(to), depth = door.crossingDepthMeters ?? 0.15;
    if (inward ? !(a <= -depth && b >= depth) : !(a >= depth && b <= -depth)) continue;
    if (Math.max(Math.abs(a), Math.abs(b)) > (door.approachDepthMeters ?? 2)) continue;
    const t = -a / (b - a);
    const lateral = Math.abs((from.x + t * (to.x - from.x) - door.x) * -n.y + (from.y + t * (to.y - from.y) - door.y) * n.x);
    const movement = Math.abs(b - a);
    if (lateral > door.widthMeters / 2 || movement < door.settings.minimumDirectionalMovementMeters) continue;
    return { doorId: door.id, direction, occurredAt, directionalMovementMeters: movement,
      evidenceWeight: inward ? door.settings.entryEvidenceWeight : door.settings.exitEvidenceWeight };
  }
  return null;
}

export function distanceFromPolygon(point: Point, region: CompiledRegion): number {
  if (pointInPolygon(point, region)) return 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let current = 0, previous = region.polygon.length - 1; current < region.polygon.length; previous = current++) {
    distance = Math.min(distance, distanceToSegment(point, region.polygon[previous], region.polygon[current]));
  }
  return distance;
}
