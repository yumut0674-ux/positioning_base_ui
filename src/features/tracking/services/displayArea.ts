import type { Point2D } from "@/src/shared/types/geometry";

export type DisplayPolygon = readonly Point2D[];
const EPS = 1e-9;
const cross = (a: Point2D, b: Point2D) => a.x * b.y - a.y * b.x;
const subtract = (a: Point2D, b: Point2D) => ({ x: a.x - b.x, y: a.y - b.y });

/** Display geometry deliberately does not share or change the inference engine's rules. */
export function inDisplayArea(point: Point2D, polygons: readonly DisplayPolygon[]): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  return polygons.some((polygon) => {
    if (polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[j], b = polygon[i];
      const edge = subtract(b, a), offset = subtract(point, a);
      if (Math.abs(cross(edge, offset)) <= EPS * Math.max(1, Math.hypot(edge.x, edge.y))
        && point.x >= Math.min(a.x, b.x) - EPS && point.x <= Math.max(a.x, b.x) + EPS
        && point.y >= Math.min(a.y, b.y) - EPS && point.y <= Math.max(a.y, b.y) + EPS) return true;
      if ((a.y > point.y) !== (b.y > point.y)
        && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  });
}

/** Split at every polygon edge, then test every interval. No fixed-step sampling:
 * even a narrow gap or a concave corridor corner must prevent interpolation. */
export function segmentInDisplayArea(from: Point2D, to: Point2D, polygons: readonly DisplayPolygon[]): boolean {
  if (!inDisplayArea(from, polygons) || !inDisplayArea(to, polygons)) return false;
  const direction = subtract(to, from);
  const lengthSquared = direction.x ** 2 + direction.y ** 2;
  if (lengthSquared === 0) return true;
  const cuts = [0, 1];
  for (const polygon of polygons) for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const edge = subtract(b, a), offset = subtract(a, from);
    const denominator = cross(direction, edge);
    if (Math.abs(denominator) > EPS) {
      const t = cross(offset, edge) / denominator, u = cross(offset, direction) / denominator;
      if (t > 0 && t < 1 && u >= -EPS && u <= 1 + EPS) cuts.push(t);
    } else if (Math.abs(cross(offset, direction)) <= EPS) {
      for (const p of [a, b]) {
        const t = ((p.x - from.x) * direction.x + (p.y - from.y) * direction.y) / lengthSquared;
        if (t > 0 && t < 1) cuts.push(t);
      }
    }
  }
  cuts.sort((a, b) => a - b);
  return cuts.every((t, i) => i === 0 || inDisplayArea({
    x: from.x + direction.x * (cuts[i - 1] + t) / 2,
    y: from.y + direction.y * (cuts[i - 1] + t) / 2,
  }, polygons));
}
