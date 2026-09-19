import type { TrackedTag } from "../types/tracking.types";
import type { RegionsConfig } from "../../regions/types/region.types";
import { resolveLocation } from "../../map/services/LocationResolverService";

export function roomDecisionLabel(tag: TrackedTag, config?: RegionsConfig | null): string {
  if (!tag.mapId && tag.mapId !== undefined) return "Kat belirlenemedi";
  const d = tag.regionInference;
  if (!d) return resolveLocation(tag.x, tag.y, tag.mapId ?? config?.map.mapId ?? "", config);
  const room = d.regionName ?? config?.regions.find(r => r.id === d.regionId)?.name ?? d.regionId;
  if (d.state === "LOCATION_LOST") return "Belirsiz · son bilinen konum";
  if (d.state === "ENTRY_CANDIDATE") return "Belirsiz · oda adayı";
  if (room) return `${room} · ${d.measurementKind === "measured" ? "Ölçülen" : "Tahmin edilen"}`;
  return "Ölçülen · koridor";
}
