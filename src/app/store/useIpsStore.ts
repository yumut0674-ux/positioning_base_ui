import { create } from "zustand";
import type { Point2D } from "@/src/shared/types/geometry";
import type { AnchorDefinition, MapLayerId, ViewportState } from "@/src/features/map/types/map.types";
import { TAG_LIVE_TIMEOUT_MS, type TagStatus, type TrackedTag } from "@/src/features/tracking/types/tracking.types";
import type { TagDefinition } from "@/src/features/tracking/services/tagApi";

interface MeasurementState {
  readonly enabled: boolean;
  readonly start: Point2D | null;
  readonly end: Point2D | null;
}

interface IpsState {
  readonly viewport: ViewportState;
  readonly layers: Record<MapLayerId, boolean>;
  readonly tags: Record<string, TrackedTag>;
  readonly observedTags: Record<string, TrackedTag>;
  readonly anchors: readonly AnchorDefinition[];
  readonly tagDefinitions: Record<string, TagDefinition>;
  readonly selectedTagId: string | null;
  readonly cursorWorld: Point2D | null;
  readonly connectionMode: "live" | "simulation" | "reconnecting";
  readonly showInspector: boolean;
  readonly showLayersPanel: boolean;
  readonly measurement: MeasurementState;
  readonly mapFocusRequest: number;
  setViewport: (viewport: ViewportState) => void;
  toggleLayer: (layer: MapLayerId) => void;
  upsertTag: (tag: TrackedTag) => void;
  observeTag: (tag: TrackedTag) => void;
  refreshTagActivity: (now?: number) => void;
  setAnchors: (anchors: readonly AnchorDefinition[]) => void;
  setTagDefinitions: (tags: readonly TagDefinition[]) => void;
  selectTag: (tagId: string | null) => void;
  setCursorWorld: (point: Point2D | null) => void;
  toggleInspector: () => void;
  toggleLayersPanel: () => void;
  toggleMeasurement: () => void;
  setMeasurementPoint: (point: Point2D) => void;
  cancelMeasurement: () => void;
  requestMapFocus: () => void;
}

export const useIpsStore = create<IpsState>((set) => ({
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
  cursorWorld: null,
  connectionMode: "live",
  showInspector: false,
  showLayersPanel: false,
  measurement: { enabled: false, start: null, end: null },
  mapFocusRequest: 0,
  setViewport: (viewport) => set({ viewport }),
  toggleLayer: (layer) => set((state) => ({ layers: { ...state.layers, [layer]: !state.layers[layer] } })),
  upsertTag: (tag) => set((state) => ({ tags: { ...state.tags, [tag.id]: tag } })),
  observeTag: (tag) => set((state) => ({ observedTags: { ...state.observedTags, [tag.id]: tag } })),
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
  selectTag: (selectedTagId) => set({ selectedTagId }),
  setCursorWorld: (cursorWorld) => set({ cursorWorld }),
  toggleInspector: () => set((state) => ({ showInspector: !state.showInspector })),
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
  requestMapFocus: () => set((state) => ({ mapFocusRequest: state.mapFocusRequest + 1 })),
}));
