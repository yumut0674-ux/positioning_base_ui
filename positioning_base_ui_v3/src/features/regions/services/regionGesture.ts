import type { Point2D } from "@/src/shared/types/geometry";

export const REGION_DRAG_THRESHOLD_PX = 8;

export interface RegionPointerGesture {
  readonly start: Point2D;
  readonly moved: boolean;
}

export function hasExceededDragThreshold(start: Point2D, current: Point2D): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= REGION_DRAG_THRESHOLD_PX;
}
