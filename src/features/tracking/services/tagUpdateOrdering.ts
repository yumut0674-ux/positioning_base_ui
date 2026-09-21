import type { TrackedTag } from "../types/tracking.types";

export type OrderedTagUpdate = Pick<TrackedTag, "timestamp" | "publishedAt">;

function validPublishedAt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Orders physical measurements first and engine publications second.
 * A later publication may refine the same measurement, but can never make an
 * older measurement replace a newer physical position.
 */
export function shouldAcceptTagUpdate(current: OrderedTagUpdate, incoming: OrderedTagUpdate): boolean {
  if (incoming.timestamp < current.timestamp) return false;
  if (incoming.timestamp > current.timestamp) return true;

  const incomingPublishedAt = validPublishedAt(incoming.publishedAt);
  if (incomingPublishedAt === null) return false;
  const currentPublishedAt = validPublishedAt(current.publishedAt);
  return currentPublishedAt === null || incomingPublishedAt > currentPublishedAt;
}
