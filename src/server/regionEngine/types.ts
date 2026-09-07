import type { TrackingPosition } from "../trackingBuffer";

export type VehicleRegionState =
  | "TRACKING_OUTSIDE"
  | "ENTRY_CANDIDATE"
  | "IN_REGION"
  | "INFERRED_IN_REGION"
  | "EXIT_CANDIDATE"
  | "LOCATION_LOST";

export interface RegionEngineRules {
  readonly evidenceDurationMs?: number;
  readonly evidenceWindowMs?: number;
  readonly maxEvidenceGapMs?: number;
  readonly expectedIntervalMs?: number;
  readonly maxSpeedMetersPerSecond?: number;
  readonly lostAfterMs?: number;
  readonly relocationAfterMs?: number;
  readonly maxTags?: number;
  readonly historySize?: number;
  readonly entryConfirmationCount: number;
  readonly exitConfirmationCount: number;
  readonly exitMarginMeters: number;
}

export interface CompiledRegion {
  readonly name?: string;
  readonly coverage?: "silent" | "intermittent" | "regular";
  readonly expectedIntervalMs?: number;
  readonly wallBandMeters?: number;
  readonly sharedWallBandMeters?: number;
  readonly id: string;
  readonly polygon: readonly { readonly x: number; readonly y: number }[];
  readonly roomCenter: { readonly x: number; readonly y: number };
  readonly entrances: readonly ({ readonly id: string; readonly x: number; readonly y: number } & Pick<import("../../features/regions/types/region.types").RegionEntrance, "widthMeters" | "inwardNormal" | "connectsTo" | "approachDepthMeters" | "crossingDepthMeters">)[];
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
}

export interface CompiledRegionsConfig {
  readonly version?: string;
  readonly warnings?: readonly string[];
  readonly mode?: "inference" | "shadow" | "legacy";
  readonly regions: readonly CompiledRegion[];
  readonly rules: RegionEngineRules;
}

export interface ProcessedPosition extends TrackingPosition {
  readonly decisionId?: string;
  readonly publishedAt?: string;
  readonly engineVersion?: string;
  readonly configVersion?: string;
  readonly synthetic?: boolean;
  readonly positionSource: "RAW" | "REGION_CENTER";
  readonly regionInference: {
    readonly enabled: true;
    readonly state: VehicleRegionState;
    readonly regionId: string | null;
    readonly confidence?: number;
    readonly candidateRegionId?: string | null;
    readonly lastKnownRegionId?: string | null;
    readonly regionName?: string | null;
    readonly reasons?: readonly string[];
    readonly measurementKind?: "measured" | "estimated" | "uncertain";
    readonly validUntil?: string;
    readonly uncertainAfter?: string;
  };
  readonly rawPosition?: TrackingPosition;
  readonly lastRawDataTimestamp: string;
}

export interface VehicleRegionStatus {
  readonly vehicleId: string;
  state: VehicleRegionState;
  lastRawPosition: TrackingPosition;
  resolvedPosition: ProcessedPosition;
  activeRegionId: string | null;
  candidateRegionId: string | null;
  entryConfidence: number;
  lastRawDataTimestamp: number;
  lastPublishedTimestamp: number;
  insideConfirmationCount: number;
  exitConfirmationCount: number;
}

export interface RegionEngineStatus {
  readonly enabled: boolean;
  readonly rawPort: number;
  readonly processedPort: number;
  readonly activeVehicleCount: number;
  readonly vehiclesInRegions: number;
  readonly configLoaded: boolean;
}
