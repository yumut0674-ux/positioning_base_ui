import type {
  AnchorDefinition,
  FloorPlanDefinition,
  MapCalibration,
  ViewportState,
} from "../types/map.types";
import type { Size2D } from "@/src/shared/types/geometry";

export const MAP_FLOOR_PLAN: FloorPlanDefinition = {
  id: "hq-l1",
  name: "Ortopedi",
  building: "Neü Tıp Fakültesi",
  level: "Kat 01",
  imageUrl: "/mimari.png",
  canvasSize: { width: 1348, height: 1212 },
  worldSize: { width: 44.93333333333333, height: 40.4 },
};

export const MAP_CALIBRATION: MapCalibration = {
  worldOrigin: { x: 0, y: 0 },
  canvasOrigin: { x: 0, y: MAP_FLOOR_PLAN.canvasSize.height },
  pixelsPerMeter: 30,
  invertYAxis: true,
  rotationDegrees: 0,
};

export const MAP_VIEWPORT_LIMITS = {
  minZoom: 0.38,
  maxZoom: 3.4,
  wheelZoomFactor: 1.08,
  fitPadding: 64,
} as const;

/**
 * Returns a centered viewport that contains the complete floor plan inside a
 * measured map panel. The same calculation is used for first render and the
 * user-facing fit/reset controls, so there is no screen-size-specific default
 * map position to drift from.
 */
export function getFittedMapViewport(panelSize: Size2D): ViewportState | null {
  if (panelSize.width <= 0 || panelSize.height <= 0) return null;

  // Keep the desired breathing room where possible, while still supporting
  // narrow panels without turning the available drawing area negative.
  const padding = Math.min(
    MAP_VIEWPORT_LIMITS.fitPadding,
    panelSize.width / 10,
    panelSize.height / 10,
  );
  const availableWidth = panelSize.width - padding * 2;
  const availableHeight = panelSize.height - padding * 2;
  if (availableWidth <= 0 || availableHeight <= 0) return null;

  const scale = Math.min(
    availableWidth / MAP_FLOOR_PLAN.canvasSize.width,
    availableHeight / MAP_FLOOR_PLAN.canvasSize.height,
  );

  return {
    scale,
    x: (panelSize.width - MAP_FLOOR_PLAN.canvasSize.width * scale) / 2,
    y: (panelSize.height - MAP_FLOOR_PLAN.canvasSize.height * scale) / 2,
  };
}

export const DEFAULT_ANCHORS = [
  { id: "A-01", x: 2.7, y: 21.4 },
  { id: "A-02", x: 20.8, y: 21.4 },
  { id: "A-03", x: 39.5, y: 21.4 },
  { id: "A-04", x: 2.7, y: 2.8 },
  { id: "A-05", x: 21.3, y: 2.8 },
  { id: "A-06", x: 39.5, y: 2.8 },
] as const satisfies readonly AnchorDefinition[];
