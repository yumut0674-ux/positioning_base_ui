import type { TrackedTag } from "../types/tracking.types";
import type { RegionsConfig } from "../../regions/types/region.types";
import { resolveLocation } from "../../map/services/LocationResolverService";
import { inDisplayArea } from "./displayArea";
import { assignedDisplayRoomId, isCorridorRegion } from "./roomDisplayPolicy";

export function roomDecisionLabel(tag: TrackedTag, config?: RegionsConfig | null): string {
  if (!tag.mapId && tag.mapId !== undefined) return "Kat belirlenemedi";
  const d = tag.regionInference;
  if (!d || !d.enabled) {
    if (config && (tag.mapId ?? config.map.mapId) === config.map.mapId
      && inDisplayArea(tag, config.regions.map(region => region.polygon.map(pair => pair.world)))) {
      return config.regions.some(isCorridorRegion) ? "Ölçülen · koridor" : "Belirsiz · oda ataması yok";
    }
    return resolveLocation(tag.x, tag.y, tag.mapId ?? config?.map.mapId ?? "", config);
  }
  if (d.state === "LOCATION_LOST") return "Belirsiz · son bilinen konum";
  if (d.state === "ENTRY_CANDIDATE") return "Belirsiz · oda adayı";
  const roomId = assignedDisplayRoomId(tag);
  const room = roomId ? d.regionName ?? config?.regions.find(r => r.id === roomId)?.name ?? roomId : null;
  if (room) return `${room} · ${d.measurementKind === "measured" ? "Ölçülen" : "Tahmin edilen"}`;
  return "Ölçülen · koridor";
}
