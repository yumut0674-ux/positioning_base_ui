import type { PositionAnimationConfig } from "@/src/features/tracking/types/tracking.types";

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
  /** World metres. Normal points into this room; missing geometry disables crossing inference. */
  readonly widthMeters?: number;
  readonly inwardNormal?: { readonly x: number; readonly y: number };
  readonly connectsTo?: string;
  readonly approachDepthMeters?: number;
  readonly crossingDepthMeters?: number;
}

export interface RegionDefinition {
  readonly kind?: "room" | "corridor";
  readonly coverage?: "silent" | "intermittent" | "regular";
  readonly expectedIntervalMs?: number;
  readonly wallBandMeters?: number;
  readonly sharedWallBandMeters?: number;
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly polygon: readonly CoordinatePair[];
  readonly roomCenter: CoordinatePair | null;
  readonly entrances: readonly RegionEntrance[];
}

export interface RegionsConfig {
  readonly mapDisplay?: { readonly outsideHoldMs: number };
  readonly engine?: {
    readonly evidenceDurationMs?: number;
    readonly evidenceWindowMs?: number;
    readonly maxEvidenceGapMs?: number;
    readonly expectedIntervalMs?: number;
    readonly maxSpeedMetersPerSecond?: number;
    readonly lostAfterMs?: number;
    readonly relocationAfterMs?: number;
    readonly maxTags?: number;
    readonly historySize?: number;
    readonly entryConfirmationCount?: number;
    readonly exitConfirmationCount?: number;
    readonly exitMarginMeters?: number;
  };
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
  readonly positionAnimation?: PositionAnimationConfig;
  readonly regions: readonly RegionDefinition[];
}

export type RegionEditorTool = "select" | "polygon" | "center" | "entrance";
