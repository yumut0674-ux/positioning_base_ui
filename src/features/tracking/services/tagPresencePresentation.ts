import type { TagPresenceState } from "../types/tagPresence.types";
import { formatLocationDuration } from "./tagPanelState";

export function lastObservedLocationLabel(presence: TagPresenceState): string {
  const location = presence.lastObservedLocation;
  const floor = location.mapName ?? location.floorLabel ?? location.mapId ?? "Kat belirlenemedi";
  return `${floor} · ${location.regionName ?? "Oda belirlenemedi"}`;
}

export function lastDataAgeLabel(presence: TagPresenceState, now: number): string {
  return `${formatLocationDuration(presence.lastRawReceivedAt, now)} önce`;
}

export function hiddenOnMapLabel(reason: string | undefined): string {
  return reason === "no-data" ? "Veri gelmiyor · haritada gizli"
    : reason === "no-regions" ? "Gösterim için bölge tanımlayın" : "Alan dışında · haritada gizli";
}
