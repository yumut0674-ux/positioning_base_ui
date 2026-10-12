import type { RegionDefinition } from "../../regions/types/region.types";
import type { TrackedTag } from "../types/tracking.types";

export function isCorridorRegion(region: RegionDefinition): boolean {
  return region.kind === "corridor" || (!region.kind && (/^corridor(?:-|$)/i.test(region.id) || /^koridor$/i.test(region.name)));
}

/** An entry candidate or last known room is never a current room assignment. */
export function assignedDisplayRoomId(tag: TrackedTag): string | null {
  const decision = tag.regionInference;
  return decision?.enabled && decision.regionId
    && ["IN_REGION", "INFERRED_IN_REGION", "EXIT_CANDIDATE", "ROOM_TRANSITIONED"].includes(decision.state)
    ? decision.regionId : null;
}
