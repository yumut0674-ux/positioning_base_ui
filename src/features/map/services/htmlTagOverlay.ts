import type { Point2D } from "@/src/shared/types/geometry";
import type { ViewportState } from "../types/map.types";
import type { CoordinateTransformService } from "./CoordinateTransformService";

export interface TransformStyleTarget {
  readonly style: { transform: string };
}

export function htmlTagViewportTransform(viewport: ViewportState): string {
  return `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})`;
}

export function htmlTagPositionTransform(point: Point2D): string {
  return `translate3d(${point.x}px, ${point.y}px, 0)`;
}

export function renderHtmlTagPosition(
  target: TransformStyleTarget | null,
  transform: CoordinateTransformService,
  x: number,
  y: number,
): void {
  if (!target) return;
  target.style.transform = htmlTagPositionTransform(transform.worldToCanvas({ x, y }));
}
