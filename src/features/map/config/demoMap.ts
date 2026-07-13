import type { AnchorDefinition, FloorPlanDefinition, MapCalibration } from "../types/map.types";

export const DEMO_FLOOR_PLAN: FloorPlanDefinition = {
  id: "hq-l1",
  name: "Operations Hall",
  building: "North Campus",
  level: "Level 01",
  imageUrl: "/floor-plan.jpg",
  canvasSize: { width: 1280, height: 720 },
  worldSize: { width: 42.67, height: 24 },
};

export const DEMO_CALIBRATION: MapCalibration = {
  worldOrigin: { x: 0, y: 0 },
  canvasOrigin: { x: 0, y: DEMO_FLOOR_PLAN.canvasSize.height },
  pixelsPerMeter: 30,
  invertYAxis: true,
  rotationDegrees: 0,
};

export const DEMO_ANCHORS = [
  { id: "A-01", x: 2.7, y: 21.4 },
  { id: "A-02", x: 20.8, y: 21.4 },
  { id: "A-03", x: 39.5, y: 21.4 },
  { id: "A-04", x: 2.7, y: 2.8 },
  { id: "A-05", x: 21.3, y: 2.8 },
  { id: "A-06", x: 39.5, y: 2.8 },
] as const satisfies readonly AnchorDefinition[];
