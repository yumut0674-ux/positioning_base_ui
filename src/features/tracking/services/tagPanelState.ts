import { MAP_FLOOR_PLAN } from "@/src/features/map/config/mapConfig";
import { resolveLocation } from "@/src/features/map/services/LocationResolverService";
import type { TrackedTag } from "../types/tracking.types";

export const RECENT_TAG_IDS_STORAGE_KEY = "gekon-ips.recent-tag-ids";
export const MAX_RECENT_TAGS = 5;

export interface TagLocationEntry {
  readonly locationLabel: string;
  readonly enteredAt: number;
}

export function addRecentTagId(recentTagIds: readonly string[], tagId: string): string[] {
  return [tagId, ...recentTagIds.filter((currentId) => currentId !== tagId)].slice(0, MAX_RECENT_TAGS);
}

export function parseRecentTagIds(value: string | null): string[] {
  try {
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((tagId): tagId is string => typeof tagId === "string"))].slice(0, MAX_RECENT_TAGS)
      : [];
  } catch {
    return [];
  }
}

export function readRecentTagIds(storage: Pick<Storage, "getItem">): string[] {
  return parseRecentTagIds(storage.getItem(RECENT_TAG_IDS_STORAGE_KEY));
}

export function persistRecentTagIds(storage: Pick<Storage, "setItem">, recentTagIds: readonly string[]): void {
  storage.setItem(RECENT_TAG_IDS_STORAGE_KEY, JSON.stringify(recentTagIds.slice(0, MAX_RECENT_TAGS)));
}

export function nextTagLocationEntry(
  currentEntry: TagLocationEntry | undefined,
  tag: TrackedTag,
): TagLocationEntry {
  const locationLabel = resolveLocation(tag.x, tag.y, MAP_FLOOR_PLAN.id);
  if (currentEntry?.locationLabel === locationLabel) return currentEntry;
  return {
    locationLabel,
    enteredAt: Number.isFinite(tag.timestamp) ? tag.timestamp : Date.now(),
  };
}

export function formatLocationDuration(enteredAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - enteredAt) / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours} sa ${minutes} dk` : `${minutes} dk ${seconds} sn`;
}
