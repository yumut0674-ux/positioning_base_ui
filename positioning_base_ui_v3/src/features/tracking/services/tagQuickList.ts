import type { TrackedTag } from "../types/tracking.types";
import type { TagDefinition } from "./tagApi";
import { colorForTag } from "./tagColor";
import { assignedDisplayRoomId } from "./roomDisplayPolicy";

/** Refresh the view from raw data without changing the stored engine decision or its evidence clocks. */
export function withLatestTagObservation(tag: TrackedTag, raw?: TrackedTag): TrackedTag {
  if (!raw || raw.timestamp < tag.timestamp) return tag;
  const measuredAt = new Date(raw.timestamp).toISOString();
  return {
    ...tag,
    ...(!assignedDisplayRoomId(tag) ? { x: raw.x, y: raw.y, mapId: raw.mapId } : {}),
    motionLabel: raw.motionLabel, timestamp: raw.timestamp, receivedAt: raw.receivedAt,
    status: raw.status, pdop: raw.pdop ?? null, sourceZoneId: raw.sourceZoneId, sourceZoneName: raw.sourceZoneName,
    lastRawDataTimestamp: measuredAt,
    rawPosition: { x: raw.x, y: raw.y, timestamp: measuredAt, pdop: raw.pdop ?? null,
      mapId: raw.mapId, sourceZoneId: raw.sourceZoneId, sourceZoneName: raw.sourceZoneName },
  };
}

/** Include registered tags with no observations without inventing map positions in the store. */
export function buildTagQuickList(
  definitions: Readonly<Record<string, TagDefinition>>,
  tracked: Readonly<Record<string, TrackedTag>>,
  observed: Readonly<Record<string, TrackedTag>>,
): TrackedTag[] {
  const ids = new Set([...Object.keys(definitions), ...Object.keys(tracked), ...Object.keys(observed)]);
  return [...ids].map((id): TrackedTag => {
    const tag = tracked[id] ?? observed[id] ?? {
      id, name: id, color: colorForTag(id), status: "offline", timestamp: 0, x: 0, y: 0, mapId: null,
    };
    return {
      ...withLatestTagObservation(tag, observed[id]),
      name: definitions[id]?.displayName || tag.name || id,
    };
  }).sort((left, right) => left.name.localeCompare(right.name, "tr"));
}
