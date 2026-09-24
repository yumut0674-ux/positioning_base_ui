import type { Point2D } from "@/src/shared/types/geometry";

export const TAG_LIVE_TIMEOUT_MS = 10_000;

export type TagStatus = "active" | "idle" | "warning" | "offline";

export interface TrackedTag extends Point2D {
  readonly mapId?: string | null;
  readonly sourceZoneId?: string | null;
  readonly sourceZoneName?: string | null;
  readonly rawPosition?: PositionMessage["rawPosition"];
  readonly regionInference?: PositionMessage["regionInference"];
  readonly lastRawDataTimestamp?: string;
  readonly publishedAt?: string;
  readonly positionSource?: "RAW" | "REGION_CENTER";
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly status: TagStatus;
  readonly direction?: number;
  readonly timestamp: number;
}

export interface PositionMessage extends Point2D {
  readonly mapId?: string | null;
  readonly sourceZoneId?: string | null;
  readonly sourceZoneName?: string | null;
  readonly publishedAt?: string;
  readonly receivedAt?: string;
  readonly synthetic?: boolean;
  readonly id: string;
  readonly timestamp: number;
  readonly positionSource?: "RAW" | "REGION_CENTER";
  readonly regionInference?: {
    readonly enabled: boolean;
    readonly state: string;
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
  readonly rawPosition?: { readonly x: number; readonly y: number; readonly timestamp: string; readonly mapId?: string | null; readonly sourceZoneId?: string | null; readonly sourceZoneName?: string | null };
  readonly lastRawDataTimestamp?: string;
}

export interface PositionAnimationConfig {
  readonly enabled: boolean;
  readonly mode: "buffered_interpolation";
  readonly interpolationDelayMs: number;
  readonly maximumBufferSize: number;
  readonly maximumSegmentDurationMs: number;
  readonly maximumExtrapolationMs: number;
  readonly stalePositionTimeoutMs: number;
  readonly teleportDistanceMeters: number;
  readonly teleportAnimationDurationMs: number;
  readonly regionTransitionDurationMs: number;
  readonly maximumVisualSpeedMetersPerSecond: number;
  readonly maximumTransitionDurationMs: number;
  readonly easing: "linear" | "ease_in_out";
}

export interface PositionSample extends Point2D {
  readonly mapId?: string | null;
  readonly timestamp: number;
  readonly receivedAt: number;
  readonly positionSource?: "RAW" | "REGION_CENTER";
  readonly regionId?: string | null;
}

export interface TagAnimationState {
  samples: PositionSample[];
  renderedX: number;
  renderedY: number;
  lastRenderedAt: number;
  stale: boolean;
  visualOpacity: number;
  transitionKind: "normal-route" | "region-center-route" | "non-routable-region-relocation" | null;
  relocationSequence: number;
}

export interface PositionFilter {
  next(current: Point2D, incoming: Point2D): Point2D;
}
