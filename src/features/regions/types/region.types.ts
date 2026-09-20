import type { PositionAnimationConfig } from "@/src/features/tracking/types/tracking.types";

export interface CoordinatePair {
  readonly pixel: { readonly x: number; readonly y: number };
  readonly world: { readonly x: number; readonly y: number };
}

export interface CalibrationPoint extends CoordinatePair {
  readonly id: string;
}

export type RegionCoverage = "silent" | "intermittent" | "regular";
export type DoorDirection = "bidirectional" | "entry-only" | "exit-only";
export type DoorEvidenceMode = "required" | "preferred" | "optional" | "ignored";

export interface DecisionEvidenceSettings {
  readonly entryEvidenceDurationMs: number; readonly exitEvidenceDurationMs: number;
  readonly entryConfirmationCount: number; readonly exitConfirmationCount: number;
  readonly evidenceWindowMs: number; readonly maxEvidenceGapMs: number;
  readonly expectedIntervalMs: number; readonly relocationEvidenceDurationMultiplier: number;
  readonly outsideReleaseDurationMultiplier: number; readonly exitMarginMeters: number;
}
export interface EvidenceScoreSettings {
  readonly baseScore: number; readonly maximumScore: number;
  readonly durationContributionMaximum: number; readonly durationContributionFullAtMs: number;
  readonly measurementContributionPerSample: number; readonly measurementContributionMaximum: number;
  readonly doorEntryBonus: number; readonly doorExitBonus: number;
  readonly confirmedInsideScore: number; readonly inferredInsideMaximumScore: number;
  readonly invalidMeasurementMaximumScore: number;
}
export interface MeasurementFilterSettings {
  readonly minimumHardwareQuality: number; readonly reliableEvidenceWeight: number;
  readonly wallEvidenceWeight: number; readonly maximumSpeedMetersPerSecond: number;
  readonly movementToleranceMeters: number;
}
export interface TimeoutCoverageSettings {
  readonly lostAfterMs: number; readonly relocationAfterMs: number;
  readonly regularCoverageStaleMultiplier: number; readonly intermittentCoverageStaleMultiplier: number;
  readonly silentCoverageStaleMultiplier: number; readonly lostAfterStaleMultiplier: number;
}
export interface DoorInferenceSettings {
  readonly enabled: boolean; readonly direction: DoorDirection; readonly evidenceMode: DoorEvidenceMode;
  readonly entryEvidenceWeight: number; readonly exitEvidenceWeight: number;
  readonly entryConfidenceBonus: number; readonly exitConfidenceBonus: number;
  readonly crossingValidityMs: number; readonly minimumDirectionalMovementMeters: number;
  readonly missingDoorEvidenceDurationMultiplier: number; readonly missingDoorEvidenceCountMultiplier: number;
  readonly allowEstimatedEntryAfterSignalLoss: boolean; readonly allowEstimatedExitAfterSignalLoss: boolean;
}
export type GlobalRegionEngineSettings = DecisionEvidenceSettings & EvidenceScoreSettings & MeasurementFilterSettings & TimeoutCoverageSettings & {
  readonly maxTags: number; readonly historySize: number;
  readonly doorDefaults?: Partial<DoorInferenceSettings>;
  readonly evidenceDurationMs?: number;
};
export type RoomInferenceSettings = Partial<Omit<GlobalRegionEngineSettings, "maxTags" | "historySize" | "doorDefaults" | "evidenceDurationMs">> & {
  readonly coverage?: RegionCoverage; readonly wallBandMeters?: number; readonly sharedWallBandMeters?: number;
  readonly silentEntryMaxDistanceMeters?: number;
  readonly doorDefaults?: Partial<DoorInferenceSettings>;
};
export type DoorInferenceOverrides = Partial<DoorInferenceSettings>;
export type ResolvedRoomSettings = Omit<GlobalRegionEngineSettings, "doorDefaults" | "evidenceDurationMs"> & {
  readonly coverage: RegionCoverage; readonly wallBandMeters: number; readonly sharedWallBandMeters: number;
  readonly silentEntryMaxDistanceMeters: number;
  readonly doorDefaults: DoorInferenceSettings;
};
export type ResolvedDoorSettings = DoorInferenceSettings;

export interface RegionEntrance extends CoordinatePair {
  readonly id: string;
  readonly label: string;
  /** World metres. Normal points into this room; missing geometry disables crossing inference. */
  readonly widthMeters?: number;
  readonly inwardNormal?: { readonly x: number; readonly y: number };
  readonly connectsTo?: string;
  readonly approachDepthMeters?: number;
  readonly crossingDepthMeters?: number;
  readonly inference?: DoorInferenceOverrides;
}

export interface RegionDefinition {
  readonly kind?: "room" | "corridor";
  readonly coverage?: RegionCoverage;
  readonly expectedIntervalMs?: number;
  readonly wallBandMeters?: number;
  readonly sharedWallBandMeters?: number;
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly polygon: readonly CoordinatePair[];
  readonly roomCenter: CoordinatePair | null;
  readonly entrances: readonly RegionEntrance[];
  readonly inference?: RoomInferenceSettings;
}

export interface RegionsConfig {
  readonly mapDisplay?: { readonly outsideHoldMs: number };
  readonly engine?: Partial<GlobalRegionEngineSettings>;
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
