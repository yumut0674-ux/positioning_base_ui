import type {
  AnchorDefinition,
  FloorPlanDefinition,
  MapCalibration,
  ViewportState,
} from "../types/map.types";
import type { Size2D } from "@/src/shared/types/geometry";

export const MAP_FLOOR_PLAN: FloorPlanDefinition = {
  id: "spor-koridor",
  name: "spor",
  building: "Spor Tesisi",
  level: "Spor Koridoru",
  imageUrl: "/maps/spor-koridor/floor-plan.png",
  canvasSize: { width: 3840, height: 2160 },
  worldSize: { width: 33.80736, height: 19.01664 },
};

export const MAP_CALIBRATION: MapCalibration = {
  worldOrigin: { x: 0, y: 0 },
  canvasOrigin: { x: 812.16, y: 1735.14 },
  pixelsPerMeter: 113.584734212,
  invertYAxis: true,
  rotationDegrees: 0,
};

export const MAP_VIEWPORT_LIMITS = {
  minZoom: 0.38,
  maxZoom: 3.4,
  wheelZoomFactor: 1.08,
  fitPadding: 64,
} as const;

export const MAP_TAG_FOCUS_SCALE = 0.5;

/**
 * Returns a centered viewport that contains the complete floor plan inside a
 * measured map panel. The same calculation is used for first render and the
 * user-facing fit/reset controls, so there is no screen-size-specific default
 * map position to drift from.
 */
export function getFittedMapViewport(
  panelSize: Size2D,
  mapSize: Size2D = MAP_FLOOR_PLAN.canvasSize,
): ViewportState | null {
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
    availableWidth / mapSize.width,
    availableHeight / mapSize.height,
  );

  return {
    scale,
    x: (panelSize.width - mapSize.width * scale) / 2,
    y: (panelSize.height - mapSize.height * scale) / 2,
  };
}

/** Keeps a zoomed floor plan within the visible map panel. Smaller dimensions
 * stay centered; larger dimensions may pan only until the panel remains covered. */
export function constrainMapViewport(
  viewport: ViewportState,
  panelSize: Size2D,
  mapSize: Size2D = MAP_FLOOR_PLAN.canvasSize,
): ViewportState {
  const planWidth = mapSize.width * viewport.scale;
  const planHeight = mapSize.height * viewport.scale;
  const constrainAxis = (position: number, planLength: number, panelLength: number) => {
    if (planLength <= panelLength) return (panelLength - planLength) / 2;
    return Math.min(0, Math.max(panelLength - planLength, position));
  };

  return {
    ...viewport,
    x: constrainAxis(viewport.x, planWidth, panelSize.width),
    y: constrainAxis(viewport.y, planHeight, panelSize.height),
  };
}

export function isAtFittedScale(viewport: ViewportState, fittedViewport: ViewportState): boolean {
  return viewport.scale <= fittedViewport.scale + 0.001;
}

export const DEFAULT_ANCHORS = [
  { id: "A-01", x: 1.75, y: 13.8 },
  { id: "A-02", x: 1.75, y: 7.5 },
  { id: "A-03", x: 1.5, y: 1.25 },
  { id: "A-04", x: 8.0, y: 1.25 },
  { id: "A-05", x: 14.5, y: 1.25 },
  { id: "A-06", x: 20.8, y: 1.25 },
] as const satisfies readonly AnchorDefinition[];
