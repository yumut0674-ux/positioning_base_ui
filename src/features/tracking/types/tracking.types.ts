import type { Point2D } from "@/src/shared/types/geometry";

export const TAG_LIVE_TIMEOUT_MS = 10_000;

export type TagStatus = "active" | "idle" | "warning" | "offline";

export interface TrackedTag extends Point2D {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly status: TagStatus;
  readonly battery: number;
  readonly direction?: number;
  readonly timestamp: number;
}

export interface PositionMessage extends Point2D {
  readonly id: string;
  readonly battery?: number | null;
  readonly timestamp: number;
}

export interface PositionFilter {
  next(current: Point2D, incoming: Point2D): Point2D;
}
