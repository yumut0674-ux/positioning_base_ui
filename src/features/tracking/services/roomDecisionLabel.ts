import type { TrackedTag } from "../types/tracking.types";
import type { RegionsConfig } from "../../regions/types/region.types";
import { resolveLocation } from "../../map/services/LocationResolverService";
import { inDisplayArea } from "./displayArea";
import { assignedDisplayRoomId, isCorridorRegion } from "./roomDisplayPolicy";

export function roomDecisionLabel(tag: TrackedTag, config?: RegionsConfig | null, now = Date.now()): string {
  if (!tag.mapId && tag.mapId !== undefined) return "Kat belirlenemedi";
  const d = tag.regionInference;
  if (!d || !d.enabled) {
    if (config && (tag.mapId ?? config.map.mapId) === config.map.mapId
      && inDisplayArea(tag, config.regions.map(region => region.polygon.map(pair => pair.world)))) {
      return config.regions.some(isCorridorRegion) ? "Ölçülen · koridor" : "Belirsiz · oda ataması yok";
    }
    return resolveLocation(tag.x, tag.y, tag.mapId ?? config?.map.mapId ?? "", config);
  }
  const lost = d.signalLost ? " · sinyal yok, son karar" : "";
  if (d.outsideArea) {
    const area = config?.largeAreas?.[0]?.name ?? "Alan";
    const gate = (d as { leftAreaGate?: string | null }).leftAreaGate;
    return `${area} alanından çıktı${gate ? ` (${gate})` : ""}${d.leftAreaAt ? ` · ${clock(d.leftAreaAt)}` : ""}`;
  }
  if (d.state === "LOCATION_LOST") return "Belirsiz · son bilinen konum";
  if (d.state === "ENTRY_CANDIDATE") return "Belirsiz · oda adayı";
  const roomId = assignedDisplayRoomId(tag);
  const room = roomId ? d.regionName ?? config?.regions.find(r => r.id === roomId)?.name ?? roomId : null;
  if (room) return `${room} · ${d.measurementKind === "measured" ? "Ölçülen" : "Tahmin edilen"}${lost}`;
  // Show the room the tag just left for a minute after the exit.
  const exited = d.exitedRegionId && d.exitedAt && now - Date.parse(d.exitedAt) <= RECENT_EXIT_MS
    ? config?.regions.find(r => r.id === d.exitedRegionId)?.name ?? d.exitedRegionId : null;
  return `Ölçülen · koridor${exited ? ` · çıktığı oda: ${exited} (${clock(d.exitedAt!)})` : ""}${lost}`;
}

const RECENT_EXIT_MS = 60_000;
function clock(iso: string): string {
  const at = new Date(iso);
  return Number.isFinite(at.getTime()) ? at.toLocaleTimeString("tr-TR", { hour12: false, timeZone: "Europe/Istanbul" }) : "";
}
