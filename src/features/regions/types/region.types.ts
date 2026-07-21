export interface CoordinatePair {
  readonly pixel: { readonly x: number; readonly y: number };
  readonly world: { readonly x: number; readonly y: number };
}

export interface CalibrationPoint extends CoordinatePair {
  readonly id: string;
}

export interface RegionEntrance extends CoordinatePair {
  readonly id: string;
  readonly label: string;
}

export interface RegionDefinition {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly polygon: readonly CoordinatePair[];
  readonly roomCenter: CoordinatePair | null;
  readonly entrances: readonly RegionEntrance[];
}

export interface RegionsConfig {
  readonly map: {
    readonly source: "system";
    readonly mapId: string;
    readonly image: string;
    readonly widthPx: number;
    readonly heightPx: number;
    readonly calibration: {
      readonly type: "affine";
      readonly points: readonly CalibrationPoint[];
    };
  };
  readonly regions: readonly RegionDefinition[];
}

export type RegionEditorTool = "select" | "polygon" | "center" | "entrance";
