import type { TrackedTag } from "../types/tracking.types";
import type { RegionsConfig } from "../../regions/types/region.types";
import { resolveLocation } from "../../map/services/LocationResolverService";
import { MAP_FLOOR_PLAN } from "../../map/config/mapConfig";

export function roomDecisionLabel(tag: TrackedTag, config?: RegionsConfig | null): string {
  const d = tag.regionInference;
  if (!d) return resolveLocation(tag.x, tag.y, MAP_FLOOR_PLAN.id, config);
  const room = d.regionName ?? config?.regions.find(r => r.id === d.regionId)?.name ?? d.regionId;
  if (d.state === "LOCATION_LOST") return "Belirsiz · son bilinen konum";
  if (d.state === "ENTRY_CANDIDATE") return "Belirsiz · oda adayı";
  if (room) return `${room} · ${d.measurementKind === "measured" ? "Ölçülen" : "Tahmin edilen"}`;
  return "Ölçülen · koridor";
}
