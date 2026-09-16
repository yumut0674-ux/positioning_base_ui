import { useEffect, useMemo, useRef, useState } from "react";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import { fetchAnchors } from "@/src/features/map/services/anchorApi";
import { SseTrackingGateway } from "../services/TrackingGateway";
import { ExponentialMovingAverageFilter } from "../services/positionFilters";
import { fetchTags, type TagDefinition } from "../services/tagApi";
import {
  fetchRegionEngineStatus, processedStreamUrl, REGION_ENGINE_STATUS_CHANGED_EVENT,
  type RegionEngineStatusResponse,
} from "@/src/features/regions/services/regionEngineApi";
import {
  DEFAULT_POSITION_ANIMATION_CONFIG,
  POSITION_ANIMATION_CONFIG_CHANGED_EVENT,
  resolvePositionAnimationConfig,
} from "../config/positionAnimationConfig";
import { PositionAnimationController } from "../services/PositionAnimationController";
import { TAG_LIVE_TIMEOUT_MS } from "../types/tracking.types";
import type { RegionsConfig } from "@/src/features/regions/types/region.types";
import { REGIONS_CONFIG_UPDATED_EVENT } from "@/src/features/regions/services/regionsConfig";
import { useMapDisplayTracking } from "./useMapDisplayTracking";

const TAG_COLORS = ["#5de4c7", "#f6c760", "#7aa2f7", "#dc7b8b", "#b892ff"];

function colorForTag(tagId: string): string {
  const sum = [...tagId].reduce((total, character) => total + character.charCodeAt(0), 0);
  return TAG_COLORS[sum % TAG_COLORS.length];
}

export function useRealtimeTracking(): PositionAnimationController {
  const upsertTag = useIpsStore((state) => state.upsertTag);
  const observeTag = useIpsStore((state) => state.observeTag);
  const refreshTagActivity = useIpsStore((state) => state.refreshTagActivity);
  const setAnchors = useIpsStore((state) => state.setAnchors);
  const setTagDefinitions = useIpsStore((state) => state.setTagDefinitions);
  const setRegionsConfig = useIpsStore((state) => state.setRegionsConfig);
  const [engineStatus, setEngineStatus] = useState<RegionEngineStatusResponse | null>(null);
  const engineEnabled = engineStatus?.enabled ?? false;
  const rawGateway = useMemo(() => new SseTrackingGateway("/api/tracking/ingest"), []);
  const processedGateway = useMemo(
    () => engineEnabled ? new SseTrackingGateway(processedStreamUrl()) : null,
    [engineEnabled],
  );
  const filter = useMemo(() => new ExponentialMovingAverageFilter(), []);
  const displayNames = useRef(new Map<string, string>());
  const engineStatusRevision = useRef(0);
  const positionAnimation = useMemo(
    () => new PositionAnimationController(DEFAULT_POSITION_ANIMATION_CONFIG),
    [],
  );
  const [animationEnabled, setAnimationEnabled] = useState(DEFAULT_POSITION_ANIMATION_CONFIG.enabled);
  useMapDisplayTracking(positionAnimation, engineEnabled);

  useEffect(() => {
    let active = true;
    const applyConfig = (value: unknown) => {
      try {
        const config = resolvePositionAnimationConfig(value);
        positionAnimation.setConfig(config);
        setAnimationEnabled(config.enabled);
      } catch (error) {
        console.error("POSITION_ANIMATION_CONFIG_ERROR", error);
      }
    };
    void fetch("/api/regions", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Konum animasyon config'i alınamadı");
        return response.json() as Promise<{ config: RegionsConfig }>;
      })
      .then((payload) => {
        if (!active) return;
        setRegionsConfig(payload.config);
        applyConfig(payload.config.positionAnimation);
      })
      .catch(() => undefined);
    const onConfigChanged = (event: Event) => {
      applyConfig((event as CustomEvent<RegionsConfig["positionAnimation"]>).detail);
    };
    window.addEventListener(POSITION_ANIMATION_CONFIG_CHANGED_EVENT, onConfigChanged);
    const onRegionsConfigUpdated = (event: Event) => {
      const config = (event as CustomEvent<RegionsConfig>).detail;
      if (config) setRegionsConfig(config);
    };
    window.addEventListener(REGIONS_CONFIG_UPDATED_EVENT, onRegionsConfigUpdated);
    return () => {
      active = false;
      window.removeEventListener(POSITION_ANIMATION_CONFIG_CHANGED_EVENT, onConfigChanged);
      window.removeEventListener(REGIONS_CONFIG_UPDATED_EVENT, onRegionsConfigUpdated);
    };
  }, [positionAnimation, setRegionsConfig]);

  useEffect(() => {
    if (!animationEnabled) return;
    let frame = 0;
    const animationLoop = () => {
      positionAnimation.update(Date.now());
      frame = window.requestAnimationFrame(animationLoop);
    };
    frame = window.requestAnimationFrame(animationLoop);
    return () => window.cancelAnimationFrame(frame);
  }, [animationEnabled, positionAnimation]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      const revision = engineStatusRevision.current;
      void fetchRegionEngineStatus().then((value) => {
        if (active && revision === engineStatusRevision.current) setEngineStatus(value);
      }).catch(() => undefined);
    };
    const onStatusChanged = (event: Event) => {
      engineStatusRevision.current += 1;
      const status = (event as CustomEvent<RegionEngineStatusResponse>).detail;
      if (status) setEngineStatus(status);
      else refresh();
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener(REGION_ENGINE_STATUS_CHANGED_EVENT, onStatusChanged);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener(REGION_ENGINE_STATUS_CHANGED_EVENT, onStatusChanged);
    };
  }, []);

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

  useEffect(() => rawGateway.connect((incoming) => {
    const tagId = incoming.id.toUpperCase();
    const currentObserved = useIpsStore.getState().observedTags[tagId];
    if (currentObserved && incoming.timestamp <= currentObserved.timestamp) return;
    const observed = {
      id: tagId,
      name: displayNames.current.get(tagId) || tagId,
      color: currentObserved?.color ?? colorForTag(tagId),
      status: "active" as const,
      timestamp: incoming.timestamp,
      x: incoming.x,
      y: incoming.y,
    };
    observeTag(observed);

    // Ham akış her zaman tag keşfi için dinlenir. Oda tespit modu kapalıyken
    // aynı veri haritanın da doğrudan konum kaynağıdır.
    if (engineEnabled) return;
    const current = useIpsStore.getState().tags[tagId];
    if (!current) {
      return upsertTag(observed);
    }
    const position = filter.next(current, incoming);
    upsertTag({ ...observed, ...position });
  }), [engineEnabled, filter, observeTag, positionAnimation, rawGateway, upsertTag]);

  useEffect(() => {
    if (!processedGateway) return;
    return processedGateway.connect((incoming) => {
      const tagId = incoming.id.toUpperCase();
      const name = displayNames.current.get(tagId) || tagId;
      const current = useIpsStore.getState().tags[tagId];
      if (incoming.publishedAt && current?.publishedAt && Date.parse(incoming.publishedAt) < Date.parse(current.publishedAt)) return;
      const measuredAt = incoming.lastRawDataTimestamp ? Date.parse(incoming.lastRawDataTimestamp) : incoming.timestamp;
      const next = {
        id: tagId,
        name,
        color: current?.color ?? colorForTag(tagId),
        status: Date.now() - measuredAt <= TAG_LIVE_TIMEOUT_MS ? "active" as const : "offline" as const,
        timestamp: incoming.timestamp,
        x: incoming.x,
        y: incoming.y,
      };
      const position = current && !incoming.positionSource ? filter.next(current, incoming) : incoming;
      upsertTag({ ...next, ...position, timestamp: incoming.lastRawDataTimestamp ? Date.parse(incoming.lastRawDataTimestamp) : incoming.timestamp });
    });
  }, [filter, positionAnimation, processedGateway, upsertTag]);

  useEffect(() => {
    const timer = window.setInterval(() => refreshTagActivity(), 1_000);
    return () => window.clearInterval(timer);
  }, [refreshTagActivity]);

  return positionAnimation;
}
