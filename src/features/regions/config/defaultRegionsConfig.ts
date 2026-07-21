import { MAP_CALIBRATION, MAP_FLOOR_PLAN } from "@/src/features/map/config/mapConfig";
import type { CalibrationPoint, RegionsConfig } from "../types/region.types";

export const SYSTEM_MAP_CALIBRATION_POINTS: readonly CalibrationPoint[] = [
  { id: "origin", pixel: { x: 0, y: MAP_FLOOR_PLAN.canvasSize.height }, world: { x: 0, y: 0 } },
  { id: "x-axis", pixel: { x: MAP_FLOOR_PLAN.canvasSize.width, y: MAP_FLOOR_PLAN.canvasSize.height }, world: { x: MAP_FLOOR_PLAN.worldSize.width, y: 0 } },
  { id: "y-axis", pixel: { x: 0, y: 0 }, world: { x: 0, y: MAP_FLOOR_PLAN.worldSize.height } },
];

export const DEFAULT_REGIONS_CONFIG: RegionsConfig = {
  map: {
    source: "system",
    mapId: MAP_FLOOR_PLAN.id,
    image: MAP_FLOOR_PLAN.imageUrl,
    widthPx: MAP_FLOOR_PLAN.canvasSize.width,
    heightPx: MAP_FLOOR_PLAN.canvasSize.height,
    calibration: { type: "affine", points: SYSTEM_MAP_CALIBRATION_POINTS },
  },
  regions: [],
};

export const SYSTEM_PIXELS_PER_METER = MAP_CALIBRATION.pixelsPerMeter;
