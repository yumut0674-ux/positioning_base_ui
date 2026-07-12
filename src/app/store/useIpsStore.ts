import { create } from "zustand";
import type { Point2D } from "@/src/shared/types/geometry";
import type { MapLayerId, ViewportState } from "@/src/features/map/types/map.types";
import type { TrackedTag } from "@/src/features/tracking/types/tracking.types";

interface IpsState {
  readonly viewport: ViewportState;
  readonly layers: Record<MapLayerId, boolean>;
  readonly tags: Record<string, TrackedTag>;
  readonly selectedTagId: string | null;
  readonly cursorWorld: Point2D | null;
  readonly connectionMode: "live" | "simulation" | "reconnecting";
  readonly showInspector: boolean;
  readonly showLayersPanel: boolean;
  setViewport: (viewport: ViewportState) => void;
  toggleLayer: (layer: MapLayerId) => void;
  upsertTag: (tag: TrackedTag) => void;
  selectTag: (tagId: string | null) => void;
  setCursorWorld: (point: Point2D | null) => void;
  toggleInspector: () => void;
  toggleLayersPanel: () => void;
}

export const useIpsStore = create<IpsState>((set) => ({
  viewport: { x: 42, y: 36, scale: 0.82 },
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
  selectedTagId: "TAG-001",
  cursorWorld: null,
  connectionMode: "simulation",
  showInspector: true,
  showLayersPanel: true,
  setViewport: (viewport) => set({ viewport }),
  toggleLayer: (layer) => set((state) => ({ layers: { ...state.layers, [layer]: !state.layers[layer] } })),
  upsertTag: (tag) => set((state) => ({ tags: { ...state.tags, [tag.id]: tag } })),
  selectTag: (selectedTagId) => set({ selectedTagId }),
  setCursorWorld: (cursorWorld) => set({ cursorWorld }),
  toggleInspector: () => set((state) => ({ showInspector: !state.showInspector })),
  toggleLayersPanel: () => set((state) => ({ showLayersPanel: !state.showLayersPanel })),
}));
