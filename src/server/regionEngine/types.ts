import type { TrackingPosition } from "../trackingBuffer";

export type VehicleRegionState =
  | "TRACKING_OUTSIDE"
  | "ENTRY_CANDIDATE"
  | "IN_REGION"
  | "INFERRED_IN_REGION"
  | "EXIT_CANDIDATE"
  | "LOCATION_LOST";

export interface RegionEngineRules {
  readonly entryConfirmationCount: number;
  readonly exitConfirmationCount: number;
  readonly exitMarginMeters: number;
}

export interface CompiledRegion {
  readonly id: string;
  readonly polygon: readonly { readonly x: number; readonly y: number }[];
  readonly roomCenter: { readonly x: number; readonly y: number };
  readonly entrances: readonly { readonly id: string; readonly x: number; readonly y: number }[];
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
}

export interface CompiledRegionsConfig {
  readonly regions: readonly CompiledRegion[];
  readonly rules: RegionEngineRules;
}

export interface ProcessedPosition extends TrackingPosition {
  readonly positionSource: "RAW" | "REGION_CENTER";
  readonly regionInference: {
    readonly enabled: true;
    readonly state: VehicleRegionState;
    readonly regionId: string | null;
    readonly confidence?: number;
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
