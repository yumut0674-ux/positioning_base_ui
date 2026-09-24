import type { TrackingPosition } from "../trackingBuffer";
import type { ResolvedDoorSettings, ResolvedRoomSettings } from "../../features/regions/types/region.types";

export type VehicleRegionState =
  | "TRACKING_OUTSIDE"
  | "ENTRY_CANDIDATE"
  | "IN_REGION"
  | "INFERRED_IN_REGION"
  | "EXIT_CANDIDATE"
  | "LOCATION_LOST";

export type DecisionEventType =
  | "MEASUREMENT_ACCEPTED"
  | "MEASUREMENT_REJECTED"
  | "ENTRY_CANDIDATE"
  | "ROOM_CONFIRMED"
  | "ROOM_TRANSITIONED"
  | "ROOM_INFERRED"
  | "EXIT_CANDIDATE"
  | "ROOM_EXITED"
  | "LOCATION_LOST"
  | "CONFIG_RELOADED";

export type DecisionSeverity = "info" | "warning" | "error";

export interface DecisionTraceReason {
  readonly code: string;
  readonly message: string;
}

export interface DecisionTrace {
  readonly eventType: DecisionEventType;
  readonly severity: DecisionSeverity;
  readonly previousState?: VehicleRegionState;
  readonly nextState: VehicleRegionState;
  /** Present only for an atomic direct room-to-room handoff. */
  readonly transitionId?: string;
  readonly fromRegionId?: string;
  readonly toRegionId?: string;
  readonly candidateStartedAt?: string;
  readonly effectiveAt?: string;
  readonly confirmedAt?: string;
  readonly confirmationCount?: number;
  readonly collectedDurationMs?: number;
  readonly trigger: "measurement" | "timer" | "config_reload";
  readonly input: {
    readonly measuredAt: string;
    readonly receivedAt?: string;
    readonly x: number;
    readonly y: number;
    readonly quality?: number;
    readonly signalGapMs?: number;
  };
  readonly evidence?: {
    readonly doorId?: string;
    readonly doorDistanceMeters?: number;
    readonly allowedDoorDistanceMeters?: number;
    readonly collectedMeasurements?: number;
    readonly requiredMeasurements?: number;
    readonly collectedDurationMs?: number;
    readonly requiredDurationMs?: number;
    readonly lastReliableLocation?: {
      readonly x: number;
      readonly y: number;
      readonly measuredAt: string;
      readonly kind?: "room" | "corridor";
      readonly regionId?: string;
    };
    readonly score?: EvidenceScoreComponents;
  };
  readonly outcome: {
    readonly regionId?: string;
    readonly regionName?: string;
    readonly candidateRegionId?: string;
    readonly confidence?: number;
    readonly measurementKind?: "measured" | "estimated" | "uncertain";
  };
  readonly reasons: readonly DecisionTraceReason[];
}

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

export interface CompiledCorridor {
  readonly id: string;
  readonly polygon: readonly { readonly x: number; readonly y: number }[];
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
}

export interface CompiledRegionsConfig {
  readonly version?: string;
  readonly warnings?: readonly string[];
  readonly regions: readonly CompiledRegion[];
  readonly corridors: readonly CompiledCorridor[];
  readonly rules: RegionEngineRules;
}

export interface ProcessedPosition extends TrackingPosition {
  readonly decisionId?: string;
  readonly publishedAt?: string;
  readonly engineVersion?: string;
  readonly configVersion?: string;
  readonly synthetic?: boolean;
  readonly decisionTrace?: DecisionTrace;
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

export interface SilentDoorProximityCandidate {
  readonly regionId: string;
  readonly doorId: string;
  readonly distanceMeters: number;
  readonly observedAt: number;
  readonly source: "silent-door-proximity";
}

export interface RoomSwitchCandidate {
  readonly fromRegionId: string;
  readonly toRegionId: string;
  readonly startedAt: number;
  readonly lastEvidenceAt: number;
  readonly confirmationCount: number;
  readonly collectedDurationMs: number;
}

export interface RoomTransitionTrace {
  readonly transitionId: string;
  readonly fromRegionId: string;
  readonly toRegionId: string;
  readonly candidateStartedAt: number;
  readonly effectiveAt: number;
  readonly confirmedAt: number;
  readonly confirmationCount: number;
  readonly collectedDurationMs: number;
}

export interface RegionEngineStatus {
  readonly enabled: boolean;
  readonly engineVersion?: string;
  readonly controllerRevision?: string;
  readonly regionEngineListenerCount?: number;
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
    readonly engineVersion: string;
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
  readonly silentDoorCandidateRegionId: string | null; readonly silentDoorCandidateDoorId: string | null;
  readonly silentDoorDistanceMeters: number | null; readonly silentDoorObservedAt: number | null;
  readonly silentDoorCandidateSource: "silent-door-proximity" | null;
  readonly roomSwitchCandidateRegionId?: string | null;
  readonly roomSwitchConfirmationCount?: number;
  readonly roomSwitchCollectedDurationMs?: number;
  readonly reasons: readonly string[]; readonly configVersion?: string;
}
