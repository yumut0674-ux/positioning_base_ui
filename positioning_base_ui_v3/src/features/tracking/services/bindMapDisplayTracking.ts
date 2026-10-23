import { useIpsStore } from "@/src/app/store/useIpsStore";
import { resolveMapDisplayConfig } from "../config/mapDisplayConfig";
import type { MapDisplayFilter } from "./MapDisplayFilter";
import { mapTrackingTags } from "./mapTrackingTags";
import type { TrackedTag } from "../types/tracking.types";

export function bindMapDisplayTracking(filter: MapDisplayFilter, engineEnabled: boolean): () => void {
  let previous: ReturnType<typeof useIpsStore.getState> | undefined;
  let previousCandidates: Readonly<Record<string, TrackedTag>> = {};
  const sync = () => {
    const state = useIpsStore.getState();
    const old = previous;
    previous = state; // publish() writes presentation state synchronously.
    const reconfigure = !old || old.regionsConfig !== state.regionsConfig || old.activeMapId !== state.activeMapId;
    if (!reconfigure && state.tags === old?.tags && state.observedTags === old?.observedTags
      && state.tagPresenceById === old?.tagPresenceById) return;
    filter.setHiddenTagIds(new Set(Object.values(state.tagPresenceById).filter(tag => tag.hiddenForNoData).map(tag => tag.tagCode)));
    if (reconfigure) {
      const config = state.regionsConfig && (!state.activeMapId || state.regionsConfig.map.mapId === state.activeMapId)
        ? state.regionsConfig : null;
      const polygons = config?.regions.map((region) => region.polygon.map((pair) => pair.world)) ?? [];
      filter.configure(polygons, resolveMapDisplayConfig(config?.mapDisplay).outsideHoldMs, state.activeMapId, config?.regions ?? []);
    }
    const source = mapTrackingTags(state.tags, state.observedTags, engineEnabled);
    const oldCandidates = previousCandidates;
    previousCandidates = source;
    const candidates = Object.values(source).filter((tag) => tag.mapId === state.activeMapId);
    filter.retain(new Set(candidates.map((tag) => tag.id)));
    for (const tag of candidates) {
      // REGION_CENTER bir gosterim capasi oldugu icin tam konumunda kalir;
      // ham/olculmus koordinatlar ise her veri kaynaginda ayni filtreden gecer.
      // A delayed decision may refer to an older moving measurement than the
      // stationary fallback. Switching sources must still apply that decision.
      const sourceChanged = engineEnabled && !!tag.regionInference !== !!oldCandidates[tag.id]?.regionInference;
      filter.ingest(tag, tag.positionSource !== "REGION_CENTER", reconfigure || sourceChanged);
    }
  };
  sync();
  return useIpsStore.subscribe(sync);
}
