import { useIpsStore } from "@/src/app/store/useIpsStore";
import { resolveMapDisplayConfig } from "../config/mapDisplayConfig";
import type { MapDisplayFilter } from "./MapDisplayFilter";

export function bindMapDisplayTracking(filter: MapDisplayFilter, engineEnabled: boolean): () => void {
  let previous: ReturnType<typeof useIpsStore.getState> | undefined;
  const sync = () => {
    const state = useIpsStore.getState();
    const old = previous;
    previous = state; // publish() writes presentation state synchronously.
    const reconfigure = !old || old.regionsConfig !== state.regionsConfig || old.activeMapId !== state.activeMapId;
    const source = engineEnabled ? state.tags : state.observedTags;
    if (!reconfigure && source === (engineEnabled ? old?.tags : old?.observedTags)) return;
    if (reconfigure) {
      const config = state.regionsConfig;
      const polygons = config && (!state.activeMapId || config.map.mapId === state.activeMapId)
        ? config.regions.map((region) => region.polygon.map((pair) => pair.world)) : [];
      filter.configure(polygons, resolveMapDisplayConfig(config?.mapDisplay).outsideHoldMs);
    }
    const candidates = Object.values(source).filter((tag) => !engineEnabled || !!tag.regionInference);
    filter.retain(new Set(candidates.map((tag) => tag.id)));
    for (const tag of candidates) filter.ingest(tag, !engineEnabled, reconfigure);
  };
  sync();
  return useIpsStore.subscribe(sync);
}
