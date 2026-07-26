import type { Point2D } from "@/src/shared/types/geometry";

export const TAG_LIVE_TIMEOUT_MS = 10_000;

export type TagStatus = "active" | "idle" | "warning" | "offline";

export interface TrackedTag extends Point2D {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly status: TagStatus;
  readonly direction?: number;
  readonly timestamp: number;
}

export interface PositionMessage extends Point2D {
  readonly id: string;
  readonly timestamp: number;
  readonly positionSource?: "RAW" | "REGION_CENTER";
  readonly regionInference?: {
    readonly enabled: boolean;
    readonly state: string;
    readonly regionId: string | null;
    readonly confidence?: number;
  };
  readonly rawPosition?: { readonly x: number; readonly y: number; readonly timestamp: string };
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
  readonly easing: "linear";
}

export interface PositionSample extends Point2D {
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
}

export interface PositionFilter {
  next(current: Point2D, incoming: Point2D): Point2D;
}
