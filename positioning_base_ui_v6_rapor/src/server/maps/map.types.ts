import type { Point2D } from "@/src/shared/types/geometry";

export type MapStatus = "active" | "preview" | "planned" | "disabled";

export interface MapCatalogEntry {
  readonly id: string;
  readonly buildingId: string;
  readonly buildingName: string;
  readonly floorId: string;
  readonly floorLevel: number;
  readonly floorLabel: string;
  readonly unitId: string;
  readonly unitName: string;
  readonly displayName: string;
  readonly status: MapStatus;
  readonly liveTrackingEnabled: boolean;
  readonly trackingZoneIds: readonly string[];
  readonly sortOrder: number;
  readonly configPath: string | null;
  readonly regionsConfigPath: string | null;
}

export interface MapCatalog {
  readonly version: number;
  readonly defaultMapId: string;
  /** @deprecated Compatibility hint. Consumers must use each map's liveTrackingEnabled flag. */
  readonly liveTrackingMapId: string;
  readonly maps: readonly MapCatalogEntry[];
}

export interface MapImageConfig {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

export interface MapWorldConfig {
  readonly widthMeters: number;
  readonly heightMeters: number;
}

export interface MapCalibration {
  readonly worldOrigin: Point2D;
  readonly canvasOrigin: Point2D;
  readonly pixelsPerMeter: number;
  readonly invertYAxis: boolean;
  readonly rotationDegrees: number;
}

export interface MapDetails {
  readonly id: string;
  readonly image: MapImageConfig;
  readonly world: MapWorldConfig;
  readonly calibration: MapCalibration;
  readonly updatedAt: string;
  readonly status: MapStatus;
  readonly liveTrackingEnabled: boolean;
}

export interface ActiveMapSelection {
  readonly activeMapId: string;
  readonly source: "default" | "stored" | "user";
}
