import { useEffect, useMemo, useRef } from "react";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import { fetchAnchors } from "@/src/features/map/services/anchorApi";
import { SseTrackingGateway } from "../services/TrackingGateway";
import { ExponentialMovingAverageFilter } from "../services/positionFilters";
import { fetchTags, type TagDefinition } from "../services/tagApi";

const TAG_COLORS = ["#5de4c7", "#f6c760", "#7aa2f7", "#dc7b8b", "#b892ff"];

function colorForTag(tagId: string): string {
  const sum = [...tagId].reduce((total, character) => total + character.charCodeAt(0), 0);
  return TAG_COLORS[sum % TAG_COLORS.length];
}

export function useRealtimeTracking(): void {
  const upsertTag = useIpsStore((state) => state.upsertTag);
  const refreshTagActivity = useIpsStore((state) => state.refreshTagActivity);
  const setAnchors = useIpsStore((state) => state.setAnchors);
  const setTagDefinitions = useIpsStore((state) => state.setTagDefinitions);
  const gateway = useMemo(() => new SseTrackingGateway(), []);
  const filter = useMemo(() => new ExponentialMovingAverageFilter(), []);
  const displayNames = useRef(new Map<string, string>());

  useEffect(() => {
    const applyNames = (tags: TagDefinition[]) => {
      displayNames.current = new Map(tags.map((tag) => [tag.id.toUpperCase(), tag.displayName]));
      setTagDefinitions(tags);
      const tracked = useIpsStore.getState().tags;
      tags.forEach((tag) => {
        const current = tracked[tag.id.toUpperCase()];
        if (current && current.name !== tag.displayName) {
          useIpsStore.getState().upsertTag({ ...current, name: tag.displayName });
        }
      });
    };
    void Promise.all([fetchTags(), fetchAnchors()])
      .then(([tags, anchors]) => {
        applyNames(tags);
        setAnchors(anchors);
      })
      .catch(() => undefined);
    const onDefinitionsUpdated = (event: Event) => applyNames((event as CustomEvent<TagDefinition[]>).detail);
    const onAnchorsUpdated = (event: Event) => setAnchors((event as CustomEvent).detail);
    window.addEventListener("tag-definitions-updated", onDefinitionsUpdated);
    window.addEventListener("anchor-definitions-updated", onAnchorsUpdated);
    return () => {
      window.removeEventListener("tag-definitions-updated", onDefinitionsUpdated);
      window.removeEventListener("anchor-definitions-updated", onAnchorsUpdated);
    };
  }, [setAnchors, setTagDefinitions]);

  useEffect(() => gateway.connect((incoming) => {
    const tagId = incoming.id.toUpperCase();
    const name = displayNames.current.get(tagId) || tagId;
    const current = useIpsStore.getState().tags[tagId];
    const next = {
      id: tagId,
      name,
      color: current?.color ?? colorForTag(tagId),
      status: "active" as const,
      battery: incoming.battery ?? current?.battery ?? 100,
      timestamp: incoming.timestamp,
      x: incoming.x,
      y: incoming.y,
    };
    if (!current) return upsertTag(next);
    const position = filter.next(current, incoming);
    upsertTag({ ...next, ...position });
  }), [filter, gateway, upsertTag]);

  useEffect(() => {
    const timer = window.setInterval(() => refreshTagActivity(), 1_000);
    return () => window.clearInterval(timer);
  }, [refreshTagActivity]);
}
