import type { DecisionEventType, DecisionSeverity, DecisionTrace, VehicleRegionState } from "@/src/server/regionEngine/types";

export interface DecisionLogFilters {
  readonly tagCode?: string;
  readonly from: string;
  readonly to: string;
  readonly mapId?: string;
  readonly regionId?: string;
  readonly eventType?: DecisionEventType;
  readonly state?: VehicleRegionState;
  readonly measurementKind?: "measured" | "estimated" | "uncertain";
  readonly engineVersion?: string;
  readonly configVersion?: string;
  readonly importantOnly?: boolean;
  readonly cursor?: string;
  readonly limit: number;
}

export interface DecisionLogSummary {
  readonly decisionId: string;
  readonly tagCode: string;
  readonly measuredAt: string;
  readonly receivedAt?: string;
  readonly publishedAt: string;
  readonly mapId?: string;
  readonly eventType: DecisionEventType;
  readonly severity: DecisionSeverity;
  readonly previousState?: VehicleRegionState;
  readonly nextState: VehicleRegionState;
  readonly regionId?: string;
  readonly regionName?: string;
  readonly candidateRegionId?: string;
  readonly measurementKind?: "measured" | "estimated" | "uncertain";
  readonly confidence?: number;
  readonly rawX?: number;
  readonly rawY?: number;
  readonly publishedX?: number;
  readonly publishedY?: number;
  readonly doorId?: string;
  readonly doorDistanceMeters?: number;
  readonly reasonCodes: readonly string[];
  readonly shortReason?: string;
  readonly engineVersion: string;
  readonly configVersion: string;
}

export interface DecisionLogDetail extends DecisionLogSummary {
  readonly payload: Record<string, unknown>;
  readonly decisionTrace?: DecisionTrace;
}

export interface DecisionLogListResponse {
  readonly items: readonly DecisionLogSummary[];
  readonly nextCursor: string | null;
  readonly metadata: {
    readonly filteredCount: number;
    readonly returnedCount: number;
    readonly countAccuracy: "exact" | "estimated";
  };
}
