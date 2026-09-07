import { create } from "zustand";
import type { Point2D } from "@/src/shared/types/geometry";
import type { AnchorDefinition, MapLayerId, ViewportState } from "@/src/features/map/types/map.types";
import { TAG_LIVE_TIMEOUT_MS, type TagStatus, type TrackedTag } from "@/src/features/tracking/types/tracking.types";
import type { TagDefinition } from "@/src/features/tracking/services/tagApi";
import type { RegionsConfig } from "@/src/features/regions/types/region.types";
import { addRecentTagId, nextTagLocationEntry, type TagLocationEntry } from "@/src/features/tracking/services/tagPanelState";
import { MAP_TAG_FOCUS_SCALE } from "@/src/features/map/config/mapConfig";

function boundedRecord<T>(record: Record<string,T>): Record<string,T> {
  const keys=Object.keys(record);
  for (let i=0;i<keys.length-5000;i++) delete record[keys[i]];
  return record;
}

interface MeasurementState {
  readonly enabled: boolean;
  readonly start: Point2D | null;
  readonly end: Point2D | null;
}

interface IpsState {
  readonly activeMapId: string | null;
  readonly readyMapId: string | null;
  readonly pendingTagFocusId: string | null;
  readonly viewport: ViewportState;
  readonly layers: Record<MapLayerId, boolean>;
  readonly tags: Record<string, TrackedTag>;
  readonly observedTags: Record<string, TrackedTag>;
  readonly anchors: readonly AnchorDefinition[];
  readonly tagDefinitions: Record<string, TagDefinition>;
  readonly selectedTagId: string | null;
  readonly recentTagIds: readonly string[];
  readonly tagLocationEntries: Record<string, TagLocationEntry>;
  readonly regionsConfig: RegionsConfig | null;
  readonly connectionMode: "live" | "simulation" | "reconnecting";
  readonly showLayersPanel: boolean;
  readonly measurement: MeasurementState;
  readonly mapFocusRequest: number;
  readonly mapFocusScale: number | null;
  readonly mapFitRequest: number;
  setActiveMapId: (mapId: string) => void;
  markMapReady: (mapId: string) => void;
  selectTagOnMap: (tagId: string, mapId: string) => void;
  setViewport: (viewport: ViewportState) => void;
  toggleLayer: (layer: MapLayerId) => void;
  upsertTag: (tag: TrackedTag) => void;
  observeTag: (tag: TrackedTag) => void;
  refreshTagActivity: (now?: number) => void;
  setAnchors: (anchors: readonly AnchorDefinition[]) => void;
  setTagDefinitions: (tags: readonly TagDefinition[]) => void;
  setRegionsConfig: (config: RegionsConfig) => void;
  selectTag: (tagId: string | null) => void;
  selectTagAndFocus: (tagId: string) => void;
  hydrateRecentTagIds: (tagIds: readonly string[]) => void;
  toggleLayersPanel: () => void;
  toggleMeasurement: () => void;
  setMeasurementPoint: (point: Point2D) => void;
  cancelMeasurement: () => void;
  requestMapFocus: () => void;
  requestMapFit: () => void;
}

export const useIpsStore = create<IpsState>((set) => ({
  activeMapId: null,
  readyMapId: null,
  pendingTagFocusId: null,
  // MapViewport replaces this neutral value once its host has real dimensions.
  viewport: { x: 0, y: 0, scale: 1 },
  layers: {
    grid: true,
    floorPlan: true,
    references: true,
    anchors: true,
    sensors: false,
    tags: true,
    routes: true,
    selection: true,
  },
  tags: {},
  observedTags: {},
  anchors: [],
  tagDefinitions: {},
  selectedTagId: "TAG-001",
  recentTagIds: [],
  tagLocationEntries: {},
  regionsConfig: null,
  connectionMode: "live",
  showLayersPanel: false,
  measurement: { enabled: false, start: null, end: null },
  mapFocusRequest: 0,
  mapFocusScale: null,
  mapFitRequest: 0,
  setActiveMapId: (activeMapId) => set((state) => state.activeMapId === activeMapId
    ? state
    : { activeMapId, readyMapId: null, pendingTagFocusId: null, mapFocusScale: null }),
  markMapReady: (mapId) => set((state) => {
    if (state.activeMapId !== mapId) return state;
    if (!state.pendingTagFocusId) return state.readyMapId === mapId ? state : { readyMapId: mapId };
    return {
      readyMapId: mapId,
      pendingTagFocusId: null,
      mapFocusRequest: state.mapFocusRequest + 1,
    };
  }),
  selectTagOnMap: (selectedTagId, activeMapId) => set((state) => ({
    activeMapId,
    readyMapId: state.activeMapId === activeMapId ? state.readyMapId : null,
    selectedTagId,
    recentTagIds: addRecentTagId(state.recentTagIds, selectedTagId),
    pendingTagFocusId: state.readyMapId === activeMapId ? null : selectedTagId,
    mapFocusRequest: state.readyMapId === activeMapId ? state.mapFocusRequest + 1 : state.mapFocusRequest,
    mapFocusScale: MAP_TAG_FOCUS_SCALE,
  })),
  setViewport: (viewport) => set({ viewport }),
  toggleLayer: (layer) => set((state) => ({ layers: { ...state.layers, [layer]: !state.layers[layer] } })),
  upsertTag: (tag) => set((state) => ({
    tags: boundedRecord({ ...state.tags, [tag.id]: tag }),
    tagLocationEntries: boundedRecord({
      ...state.tagLocationEntries,
      [tag.id]: nextTagLocationEntry(state.tagLocationEntries[tag.id], tag, state.regionsConfig),
    }),
  })),
  observeTag: (tag) => set((state) => ({ observedTags: boundedRecord({ ...state.observedTags, [tag.id]: tag }) })),
  refreshTagActivity: (now = Date.now()) => set((state) => {
    let changed = false;
    const refresh = (source: Record<string, TrackedTag>) => Object.fromEntries(Object.entries(source).map(([id, tag]) => {
      const status: TagStatus = now - tag.timestamp <= TAG_LIVE_TIMEOUT_MS ? "active" : "offline";
      if (tag.status !== status) changed = true;
      return [id, tag.status === status ? tag : { ...tag, status }];
    }));
    const tags = refresh(state.tags);
    const observedTags = refresh(state.observedTags);
    return changed ? { tags, observedTags } : state;
  }),
  setAnchors: (anchors) => set({ anchors }),
  setTagDefinitions: (tags) => set({ tagDefinitions: Object.fromEntries(tags.map((tag) => [tag.id.toUpperCase(), tag])) }),
  setRegionsConfig: (regionsConfig) => set((state) => ({
    regionsConfig,
    tagLocationEntries: Object.fromEntries(Object.entries(state.tags).map(([tagId, tag]) => [
      tagId,
      nextTagLocationEntry(state.tagLocationEntries[tagId], tag, regionsConfig),
    ])),
  })),
  selectTag: (selectedTagId) => set((state) => ({
    selectedTagId,
    recentTagIds: selectedTagId ? addRecentTagId(state.recentTagIds, selectedTagId) : state.recentTagIds,
  })),
  selectTagAndFocus: (selectedTagId) => set((state) => ({
    selectedTagId,
    recentTagIds: addRecentTagId(state.recentTagIds, selectedTagId),
    mapFocusRequest: state.mapFocusRequest + 1,
    mapFocusScale: null,
  })),
  hydrateRecentTagIds: (recentTagIds) => set({ recentTagIds: [...new Set(recentTagIds)].slice(0, 5) }),
  toggleLayersPanel: () => set((state) => ({ showLayersPanel: !state.showLayersPanel })),
  toggleMeasurement: () => set((state) => ({
    measurement: state.measurement.enabled
      ? { enabled: false, start: null, end: null }
      : { enabled: true, start: null, end: null },
  })),
  setMeasurementPoint: (point) => set((state) => ({
    measurement: !state.measurement.start || state.measurement.end
      ? { enabled: true, start: point, end: null }
      : { enabled: true, start: state.measurement.start, end: point },
  })),
  cancelMeasurement: () => set({ measurement: { enabled: false, start: null, end: null } }),
  requestMapFocus: () => set((state) => ({ mapFocusRequest: state.mapFocusRequest + 1, mapFocusScale: null })),
  requestMapFit: () => set((state) => ({ mapFitRequest: state.mapFitRequest + 1 })),
}));
