import { create } from "zustand";
import type { Point2D } from "@/src/shared/types/geometry";
import type { AnchorDefinition, MapLayerId, ViewportState } from "@/src/features/map/types/map.types";
import { DEFAULT_MAP_VIEWPORT } from "@/src/features/map/config/mapConfig";
import { TAG_LIVE_TIMEOUT_MS, type TrackedTag } from "@/src/features/tracking/types/tracking.types";
import type { TagDefinition } from "@/src/features/tracking/services/tagApi";

interface IpsState {
  readonly viewport: ViewportState;
  readonly layers: Record<MapLayerId, boolean>;
  readonly tags: Record<string, TrackedTag>;
  readonly anchors: readonly AnchorDefinition[];
  readonly tagDefinitions: Record<string, TagDefinition>;
  readonly selectedTagId: string | null;
  readonly cursorWorld: Point2D | null;
  readonly connectionMode: "live" | "simulation" | "reconnecting";
  readonly showInspector: boolean;
  readonly showLayersPanel: boolean;
  setViewport: (viewport: ViewportState) => void;
  toggleLayer: (layer: MapLayerId) => void;
  upsertTag: (tag: TrackedTag) => void;
  refreshTagActivity: (now?: number) => void;
  setAnchors: (anchors: readonly AnchorDefinition[]) => void;
  setTagDefinitions: (tags: readonly TagDefinition[]) => void;
  selectTag: (tagId: string | null) => void;
  setCursorWorld: (point: Point2D | null) => void;
  toggleInspector: () => void;
  toggleLayersPanel: () => void;
}

export const useIpsStore = create<IpsState>((set) => ({
  viewport: DEFAULT_MAP_VIEWPORT,
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
  anchors: [],
  tagDefinitions: {},
  selectedTagId: "TAG-001",
  cursorWorld: null,
  connectionMode: "live",
  showInspector: false,
  showLayersPanel: false,
  setViewport: (viewport) => set({ viewport }),
  toggleLayer: (layer) => set((state) => ({ layers: { ...state.layers, [layer]: !state.layers[layer] } })),
  upsertTag: (tag) => set((state) => ({ tags: { ...state.tags, [tag.id]: tag } })),
  refreshTagActivity: (now = Date.now()) => set((state) => {
    let changed = false;
    const tags = Object.fromEntries(Object.entries(state.tags).map(([id, tag]) => {
      const status = now - tag.timestamp <= TAG_LIVE_TIMEOUT_MS ? "active" : "offline";
      if (tag.status !== status) changed = true;
      return [id, tag.status === status ? tag : { ...tag, status }];
    }));
    return changed ? { tags } : state;
  }),
  setAnchors: (anchors) => set({ anchors }),
  setTagDefinitions: (tags) => set({ tagDefinitions: Object.fromEntries(tags.map((tag) => [tag.id, tag])) }),
  selectTag: (selectedTagId) => set({ selectedTagId }),
  setCursorWorld: (cursorWorld) => set({ cursorWorld }),
  toggleInspector: () => set((state) => ({ showInspector: !state.showInspector })),
  toggleLayersPanel: () => set((state) => ({ showLayersPanel: !state.showLayersPanel })),
}));
