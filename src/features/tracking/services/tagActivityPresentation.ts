import { TAG_LIVE_TIMEOUT_MS, type TrackedTag } from "../types/tracking.types";
import type { TagPresenceState } from "../types/tagPresence.types";
import { assignedDisplayRoomId } from "./roomDisplayPolicy";

export type TagActivity = "moving" | "stationary" | "offline";
export const TAG_ACTIVITY_LABELS: Record<TagActivity, string> = {
  moving: "Hareketli", stationary: "Sabit", offline: "Pasif",
};
export const PASSIVE_TAG_COLOR = "#8495a9";

export function tagActivityPresentation(tag: TrackedTag | undefined, presence?: TagPresenceState, now = Date.now()) {
  // Raw measurements determine freshness and motion; engine heartbeats do not.
  const source = presence && (!tag || presence.lastRawMeasuredAt >= tag.timestamp) ? presence.raw : tag;
  const measuredAt = source?.lastRawDataTimestamp ? Date.parse(source.lastRawDataTimestamp) : source?.timestamp ?? 0;
  const receivedAt = source?.receivedAt ? Date.parse(source.receivedAt) : measuredAt;
  const hasData = measuredAt > 0 && Number.isFinite(measuredAt) && Number.isFinite(receivedAt)
    && now - Math.min(measuredAt, receivedAt) <= TAG_LIVE_TIMEOUT_MS && !presence?.hiddenForNoData;
  const activity: TagActivity = !hasData ? "offline" : source?.motionLabel === "moving" ? "moving" : "stationary";
  const uncertainAfter = Date.parse(tag?.regionInference?.uncertainAfter ?? "");
  const hasRoomDecision = Boolean(tag && assignedDisplayRoomId(tag) && !presence?.hiddenForNoData
    && (!Number.isFinite(uncertainAfter) || now < uncertainAfter));
  const isLiveColor = activity === "moving" || hasRoomDecision;
  return { activity, label: TAG_ACTIVITY_LABELS[activity], isLiveColor, color: isLiveColor ? tag?.color : PASSIVE_TAG_COLOR };
}
