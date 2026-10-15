import type { HistoricalPosition, LocationStay } from "@/src/features/map/services/RouteTimelineService";
import type { ZoneTimelineEntry } from "@/src/server/location/location.types";

/** Index each floor once instead of scanning all positions for every visit. */
export function buildDecisionStays(positions: readonly HistoricalPosition[], entries: readonly ZoneTimelineEntry[]): readonly LocationStay[] {
  const byMap = new Map<string | null, { position: HistoricalPosition; time: number }[]>();
  for (const position of positions) {
    const mapId = position.mapId ?? null;
    const list = byMap.get(mapId) ?? [];
    list.push({ position, time: Date.parse(position.timestamp) });
    byMap.set(mapId, list);
  }
  for (const list of byMap.values()) list.sort((a, b) => a.time - b.time);
  return entries.map((entry, index): LocationStay => {
    const list = byMap.get(entry.mapId ?? null) ?? [];
    const from = Date.parse(entry.enteredAt), to = Date.parse(entry.exitedAt);
    const boundary = (time: number, inclusive: boolean) => {
      let low = 0, high = list.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (list[mid].time < time || (inclusive && list[mid].time === time)) low = mid + 1;
        else high = mid;
      }
      return low;
    };
    return {
      id: `decision-${index}`, locationLabel: entry.zoneName, startedAt: entry.enteredAt, endedAt: entry.exitedAt,
      durationMs: entry.durationSeconds * 1000,
      positions: list.slice(boundary(from, false), boundary(to, true)).map(item => item.position),
      mapId: entry.mapId, isMapTransition: index > 0 && entries[index - 1].mapId !== entry.mapId,
      isDataGap: entry.zoneName === "Belirsiz",
    };
  });
}
