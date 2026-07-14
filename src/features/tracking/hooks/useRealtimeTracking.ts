import { useEffect, useMemo, useRef } from "react";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import { MockTrackingGateway } from "../services/TrackingGateway";
import { ExponentialMovingAverageFilter } from "../services/positionFilters";
import { fetchTags, type TagDefinition } from "../services/tagApi";

export function useRealtimeTracking(): void {
  const upsertTag = useIpsStore((state) => state.upsertTag);
  const gateway = useMemo(() => new MockTrackingGateway(), []);
  const filter = useMemo(() => new ExponentialMovingAverageFilter(), []);
  const displayNames = useRef(new Map<string, string>());

  useEffect(() => {
    const applyNames = (tags: TagDefinition[]) => { displayNames.current = new Map(tags.map((tag) => [tag.id, tag.displayName])); };
    void fetchTags().then(applyNames).catch(() => undefined);
    const onDefinitionsUpdated = (event: Event) => applyNames((event as CustomEvent<TagDefinition[]>).detail);
    window.addEventListener("tag-definitions-updated", onDefinitionsUpdated);
    return () => window.removeEventListener("tag-definitions-updated", onDefinitionsUpdated);
  }, []);

  useEffect(() => gateway.connect((incoming) => {
    const name = displayNames.current.get(incoming.id) || incoming.name;
    const current = useIpsStore.getState().tags[incoming.id];
    if (!current) return upsertTag({ ...incoming, name });
    const position = filter.next(current, incoming);
    upsertTag({ ...incoming, ...position, name });
  }), [filter, gateway, upsertTag]);
}
