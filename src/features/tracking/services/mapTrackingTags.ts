import type { TrackedTag } from "../types/tracking.types";
import { assignedDisplayRoomId } from "./roomDisplayPolicy";

/** Display candidates only: a stationary fallback never creates a room decision. */
export function mapTrackingTags(
  tracked: Readonly<Record<string, TrackedTag>>,
  observed: Readonly<Record<string, TrackedTag>>,
  engineEnabled: boolean,
): Readonly<Record<string, TrackedTag>> {
  if (!engineEnabled) return observed;
  const candidates: Record<string, TrackedTag> = {};
  for (const [id, tag] of Object.entries(tracked)) {
    if (tag.regionInference || tag.motionLabel === "stationary") candidates[id] = tag;
  }
  for (const [id, raw] of Object.entries(observed)) {
    if (raw.motionLabel !== "stationary") continue;
    const current = tracked[id];
    if (current && (current.timestamp > raw.timestamp || assignedDisplayRoomId(current))) continue;
    candidates[id] = raw;
  }
  return candidates;
}
