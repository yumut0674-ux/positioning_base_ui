import { MAP_CALIBRATION, MAP_FLOOR_PLAN } from "@/src/features/map/config/mapConfig";
import type { CalibrationPoint, RegionsConfig } from "../types/region.types";
import { DEFAULT_POSITION_ANIMATION_CONFIG } from "@/src/features/tracking/config/positionAnimationConfig";
import { DEFAULT_REGION_ENGINE_SETTINGS } from "./regionInferenceSettings";

export const SYSTEM_MAP_CALIBRATION_POINTS: readonly CalibrationPoint[] = [
  { id: "origin", pixel: MAP_CALIBRATION.canvasOrigin, world: MAP_CALIBRATION.worldOrigin },
  {
    id: "x-axis",
    pixel: { x: MAP_CALIBRATION.canvasOrigin.x + MAP_CALIBRATION.pixelsPerMeter, y: MAP_CALIBRATION.canvasOrigin.y },
    world: { x: MAP_CALIBRATION.worldOrigin.x + 1, y: MAP_CALIBRATION.worldOrigin.y },
  },
  {
    id: "y-axis",
    pixel: { x: MAP_CALIBRATION.canvasOrigin.x, y: MAP_CALIBRATION.canvasOrigin.y - MAP_CALIBRATION.pixelsPerMeter },
    world: { x: MAP_CALIBRATION.worldOrigin.x, y: MAP_CALIBRATION.worldOrigin.y + 1 },
  },
];

export const DEFAULT_REGIONS_CONFIG: RegionsConfig = {
  mapDisplay: { outsideHoldMs: 2_000 },
  engine: DEFAULT_REGION_ENGINE_SETTINGS,
  map: {
    source: "system",
    mapId: MAP_FLOOR_PLAN.id,
    image: MAP_FLOOR_PLAN.imageUrl,
    widthPx: MAP_FLOOR_PLAN.canvasSize.width,
    heightPx: MAP_FLOOR_PLAN.canvasSize.height,
    calibration: { type: "affine", points: SYSTEM_MAP_CALIBRATION_POINTS },
  },
  positionAnimation: DEFAULT_POSITION_ANIMATION_CONFIG,
  regions: [],
};

export const SYSTEM_PIXELS_PER_METER = MAP_CALIBRATION.pixelsPerMeter;
