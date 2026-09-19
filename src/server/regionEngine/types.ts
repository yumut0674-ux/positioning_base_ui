import type { TrackingPosition } from "../trackingBuffer";
import type { ResolvedDoorSettings, ResolvedRoomSettings } from "../../features/regions/types/region.types";

export type VehicleRegionState =
  | "TRACKING_OUTSIDE"
  | "ENTRY_CANDIDATE"
  | "IN_REGION"
  | "INFERRED_IN_REGION"
  | "EXIT_CANDIDATE"
  | "LOCATION_LOST";

export type RegionEngineRules = ResolvedRoomSettings & { readonly maxTags: number; readonly historySize: number };

export interface CompiledDoor {
  readonly id: string; readonly x: number; readonly y: number;
  readonly widthMeters?: number; readonly inwardNormal?: { readonly x: number; readonly y: number };
  readonly connectsTo?: string; readonly approachDepthMeters?: number; readonly crossingDepthMeters?: number;
  readonly settings: ResolvedDoorSettings;
}

export interface CompiledRegion {
  readonly name?: string;
  readonly coverage?: "silent" | "intermittent" | "regular";
  readonly expectedIntervalMs?: number;
  readonly wallBandMeters?: number;
  readonly sharedWallBandMeters?: number;
  readonly settings: ResolvedRoomSettings;
  readonly usesDoorPolicy: boolean;
  readonly id: string;
  readonly polygon: readonly { readonly x: number; readonly y: number }[];
  readonly roomCenter: { readonly x: number; readonly y: number };
  readonly entrances: readonly CompiledDoor[];
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
}

export interface CompiledRegionsConfig {
  readonly version?: string;
  readonly warnings?: readonly string[];
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
  readonly configVersion?: string;
  readonly warnings?: readonly string[];
  readonly diagnostics?: readonly RegionVehicleDiagnostic[];
  readonly maps?: Readonly<Record<string, {
    readonly activeVehicleCount: number;
    readonly vehiclesInRegions: number;
    readonly configLoaded: boolean;
    readonly configVersion?: string;
    readonly warnings?: readonly string[];
  }>>;
}

export interface EvidenceScoreComponents {
  readonly base: number; readonly duration: number; readonly measurements: number; readonly door: number; readonly total: number;
}
export interface RegionVehicleDiagnostic {
  readonly vehicleId: string; readonly state: VehicleRegionState; readonly activeRegionId: string | null;
  readonly candidateRegionId: string | null; readonly doorId: string | null; readonly doorDirection: "entry" | "exit" | null;
  readonly doorEvidenceMode: string | null; readonly collectedDurationMs: number; readonly requiredDurationMs: number;
  readonly collectedMeasurements: number; readonly requiredMeasurements: number; readonly lastMeasurementQuality: number | null;
  readonly doorEvidenceRemainingMs: number | null; readonly score: EvidenceScoreComponents;
  readonly reasons: readonly string[]; readonly configVersion?: string;
}
