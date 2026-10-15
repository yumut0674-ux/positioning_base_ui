import type { TrackedTag } from "../types/tracking.types";
import { assignedDisplayRoomId } from "./roomDisplayPolicy";
import { withLatestTagObservation } from "./tagQuickList";

/** Display candidates only: raw visibility does not require motion metadata or create a room decision. */
export function mapTrackingTags(
  tracked: Readonly<Record<string, TrackedTag>>,
  observed: Readonly<Record<string, TrackedTag>>,
  engineEnabled: boolean,
): Readonly<Record<string, TrackedTag>> {
  if (!engineEnabled) return observed;
  const candidates: Record<string, TrackedTag> = { ...tracked };
  for (const [id, raw] of Object.entries(observed)) {
    const current = tracked[id];
    if (current && current.timestamp > raw.timestamp) continue;
    candidates[id] = current && assignedDisplayRoomId(current) ? withLatestTagObservation(current, raw) : raw;
  }
  return candidates;
}
