export interface AreaEditorVisibility {
  readonly hiddenAreas: readonly string[];
  readonly hiddenGates: readonly string[];
  readonly hideAll: boolean;
}
export const EMPTY_AREA_VISIBILITY: AreaEditorVisibility = { hiddenAreas: [], hiddenGates: [], hideAll: false };
export const areaVisibilityKey = (mapId: string) => `ips-area-editor-visibility:${mapId}`;
export function readAreaVisibility(mapId: string, storage: Pick<Storage, "getItem">): AreaEditorVisibility {
  try {
    const value = JSON.parse(storage.getItem(areaVisibilityKey(mapId)) ?? "null") as Partial<AreaEditorVisibility> | null;
    return { hiddenAreas: Array.isArray(value?.hiddenAreas) ? value.hiddenAreas.filter(item => typeof item === "string") : [],
      hiddenGates: Array.isArray(value?.hiddenGates) ? value.hiddenGates.filter(item => typeof item === "string") : [], hideAll: value?.hideAll === true };
  } catch { return EMPTY_AREA_VISIBILITY; }
}
export function isAreaVisible(visibility: AreaEditorVisibility, areaId: string): boolean {
  return !visibility.hideAll && !visibility.hiddenAreas.includes(areaId);
}
export function isGateVisible(visibility: AreaEditorVisibility, areaId: string, gateId: string): boolean {
  return isAreaVisible(visibility, areaId) && !visibility.hiddenGates.includes(gateId);
}
export function toggleAreaVisibility(value: AreaEditorVisibility, kind: "area" | "gate" | "all", id?: string): AreaEditorVisibility {
  if (kind === "all") return { ...value, hideAll: !value.hideAll };
  const field = kind === "area" ? "hiddenAreas" : "hiddenGates";
  if (!id) return value;
  const hidden = value[field];
  return { ...value, [field]: hidden.includes(id) ? hidden.filter(item => item !== id) : [...hidden, id] };
}
export function visibleSelection(visibility: AreaEditorVisibility, areaId: string | null, gateId: string | null): { areaId: string | null; gateId: string | null } {
  if (!areaId || !isAreaVisible(visibility, areaId)) return { areaId: null, gateId: null };
  if (gateId && !isGateVisible(visibility, areaId, gateId)) return { areaId: null, gateId: null };
  return { areaId, gateId };
}
