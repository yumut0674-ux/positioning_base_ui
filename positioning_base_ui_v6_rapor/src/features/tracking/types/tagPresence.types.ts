import type { PositionMessage } from "./tracking.types";
import type { SystemSettings } from "../../settings/types/settings.types";

export interface LastObservedLocation {
  readonly mapId: string | null;
  readonly mapName: string | null;
  readonly floorLabel: string | null;
  readonly regionId: string | null;
  readonly regionName: string | null;
  readonly kind: "room" | "corridor" | "unknown";
}

export interface TagPresenceState {
  readonly tagCode: string;
  readonly revision: number;
  readonly raw: PositionMessage;
  readonly processed?: PositionMessage;
  readonly lastRawReceivedAt: number;
  readonly lastRawMeasuredAt: number;
  readonly lastObservedLocation: LastObservedLocation;
  readonly hasCurrentRoomAssignment: boolean;
  readonly hiddenForNoData: boolean;
  readonly hiddenSince: number | null;
}

export interface TagPresenceSnapshot {
  readonly epoch: string;
  readonly serverNow: number;
  readonly settings: SystemSettings;
  readonly states: readonly TagPresenceState[];
  readonly warning: string | null;
}

export interface TagPresenceUpdate {
  readonly epoch: string;
  readonly serverNow: number;
  readonly state: TagPresenceState;
}

export type PersistedTagObservation = Pick<TagPresenceState,
  "tagCode" | "raw" | "lastRawReceivedAt" | "lastRawMeasuredAt" | "lastObservedLocation">;
