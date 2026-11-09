import type { TrackedTag } from "@/src/features/tracking/types/tracking.types";

export interface RawTagMarker {
  readonly id: string;
  readonly pixel: { readonly x: number; readonly y: number };
  readonly world: { readonly x: number; readonly y: number };
  readonly timestamp: number;
  readonly ageMs: number;
  readonly stale: boolean;
}

type WorldToPixel = (world: { readonly x: number; readonly y: number }) => {
  readonly x: number;
  readonly y: number;
};

/** Builds diagnostic markers directly from the last raw measurements. */
export function createRawTagMarkers(
  observedTags: Readonly<Record<string, TrackedTag>>,
  inverseTransform: WorldToPixel,
  now: number,
  liveTimeoutMs: number,
): readonly RawTagMarker[] {
  return Object.entries(observedTags).flatMap(([tagId, tag]) => {
    if (!Number.isFinite(tag.x) || !Number.isFinite(tag.y)) return [];
    const pixel = inverseTransform({ x: tag.x, y: tag.y });
    if (!Number.isFinite(pixel.x) || !Number.isFinite(pixel.y)) return [];
    const validTimestamp = Number.isFinite(tag.timestamp);
    const ageMs = validTimestamp ? Math.max(0, now - tag.timestamp) : Number.POSITIVE_INFINITY;
    return [{
      id: tagId,
      pixel,
      world: { x: tag.x, y: tag.y },
      timestamp: tag.timestamp,
      ageMs,
      stale: !validTimestamp || ageMs > liveTimeoutMs,
    }];
  });
}

export function formatRawTagAge(ageMs: number): string {
  if (!Number.isFinite(ageMs)) return "bilinmiyor";
  if (ageMs < 1_000) return `${Math.round(ageMs)} ms`;
  if (ageMs < 60_000) return `${(ageMs / 1_000).toFixed(1)} sn`;
  return `${Math.floor(ageMs / 60_000)} dk`;
}
