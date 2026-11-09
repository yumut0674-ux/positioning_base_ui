import { constrainMapViewport, getFittedMapViewport, isAtFittedScale, MAP_VIEWPORT_LIMITS } from "../config/mapConfig";
import type { ViewportState } from "../types/map.types";
import type { Point2D, Size2D } from "@/src/shared/types/geometry";

export interface MapTouchPoint extends Point2D {
  readonly id: number;
}

export interface MapTouchGesture {
  readonly touches: readonly MapTouchPoint[];
  readonly viewport: ViewportState;
}

export function createMapTouchGesture(touches: readonly MapTouchPoint[], viewport: ViewportState): MapTouchGesture | null {
  return touches.length === 1 || touches.length === 2 ? { touches, viewport } : null;
}

export function getMapTouchViewport(
  gesture: MapTouchGesture | null,
  touches: readonly MapTouchPoint[],
  viewport: ViewportState,
  panelSize: Size2D,
  mapSize: Size2D,
): ViewportState {
  // Adding, lifting, or replacing a finger establishes a new baseline. It must
  // not apply movement from a finger that belonged to the previous gesture.
  if (!gesture || touches.length !== gesture.touches.length
    || !touches.every((touch) => gesture.touches.some((previous) => previous.id === touch.id))) return viewport;

  const fitted = getFittedMapViewport(panelSize, mapSize);
  if (!fitted) return viewport;

  if (touches.length === 1) {
    if (isAtFittedScale(gesture.viewport, fitted)) return fitted;
    return constrainMapViewport({
      ...gesture.viewport,
      x: gesture.viewport.x + touches[0].x - gesture.touches[0].x,
      y: gesture.viewport.y + touches[0].y - gesture.touches[0].y,
    }, panelSize, mapSize);
  }

  if (touches.length !== 2) return viewport;
  const [previousFirst, previousSecond] = gesture.touches;
  const [first, second] = touches;
  const previousDistance = Math.hypot(previousFirst.x - previousSecond.x, previousFirst.y - previousSecond.y);
  const distance = Math.hypot(first.x - second.x, first.y - second.y);
  if (previousDistance === 0 || distance === 0) return viewport;

  const scale = Math.min(MAP_VIEWPORT_LIMITS.maxZoom, Math.max(fitted.scale, gesture.viewport.scale * distance / previousDistance));
  if (scale <= fitted.scale + 0.001) return fitted;

  const previousCenter = { x: (previousFirst.x + previousSecond.x) / 2, y: (previousFirst.y + previousSecond.y) / 2 };
  const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const mapPoint = {
    x: (previousCenter.x - gesture.viewport.x) / gesture.viewport.scale,
    y: (previousCenter.y - gesture.viewport.y) / gesture.viewport.scale,
  };
  return constrainMapViewport({
    scale,
    x: center.x - mapPoint.x * scale,
    y: center.y - mapPoint.y * scale,
  }, panelSize, mapSize);
}
