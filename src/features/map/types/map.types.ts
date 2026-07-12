import type { Point2D, Size2D } from "@/src/shared/types/geometry";

export type MapLayerId =
  | "grid"
  | "floorPlan"
  | "references"
  | "anchors"
  | "sensors"
  | "tags"
  | "routes"
  | "selection";

export interface MapCalibration {
  readonly worldOrigin: Point2D;
  readonly canvasOrigin: Point2D;
  readonly pixelsPerMeter: number;
  readonly invertYAxis: boolean;
  readonly rotationDegrees: number;
}

export interface ViewportState extends Point2D {
  readonly scale: number;
}

export interface FloorPlanDefinition {
  readonly id: string;
  readonly name: string;
  readonly building: string;
  readonly level: string;
  readonly imageUrl: string;
  readonly canvasSize: Size2D;
  readonly worldSize: Size2D;
}
