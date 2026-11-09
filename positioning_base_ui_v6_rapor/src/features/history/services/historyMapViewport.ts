export interface HistoryViewport { readonly x: number; readonly y: number; readonly scale: number }

export function zoomHistoryViewport(viewport: HistoryViewport, pointer: { readonly x: number; readonly y: number }, scale: number): HistoryViewport {
  const nextScale = Math.min(8, Math.max(.02, scale));
  return {
    scale: nextScale,
    x: pointer.x - (pointer.x - viewport.x) / viewport.scale * nextScale,
    y: pointer.y - (pointer.y - viewport.y) / viewport.scale * nextScale,
  };
}
