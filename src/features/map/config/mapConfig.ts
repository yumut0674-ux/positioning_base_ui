import type {
  AnchorDefinition,
  FloorPlanDefinition,
  MapCalibration,
  ViewportState,
} from "../types/map.types";

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

export const DEFAULT_MAP_VIEWPORT: ViewportState = {
  x: 42,
  y: 36,
  scale: 0.82,
};

export const MAP_VIEWPORT_LIMITS = {
  minZoom: 0.38,
  maxZoom: 3.4,
  wheelZoomFactor: 1.08,
  fitPadding: 64,
} as const;

export const DEFAULT_ANCHORS = [
  { id: "A-01", x: 2.7, y: 21.4 },
  { id: "A-02", x: 20.8, y: 21.4 },
  { id: "A-03", x: 39.5, y: 21.4 },
  { id: "A-04", x: 2.7, y: 2.8 },
  { id: "A-05", x: 21.3, y: 2.8 },
  { id: "A-06", x: 39.5, y: 2.8 },
] as const satisfies readonly AnchorDefinition[];
