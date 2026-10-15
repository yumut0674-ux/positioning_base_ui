import type { TrackedTag } from "../types/tracking.types";
import type { TagDefinition } from "./tagApi";
import { colorForTag } from "./tagColor";

export function withLatestTagObservation(tag: TrackedTag, raw?: TrackedTag): TrackedTag {
  return raw && raw.timestamp >= tag.timestamp ? {
    ...tag, motionLabel: raw.motionLabel, timestamp: raw.timestamp, receivedAt: raw.receivedAt,
    lastRawDataTimestamp: new Date(raw.timestamp).toISOString(),
  } : tag;
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
