"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { AppSidebar, type WorkspaceView, useSidebarCollapse } from "./components/AppSidebar";
import { StatusStrip } from "./components/StatusStrip";
import { MapViewport } from "@/src/features/map/components/MapViewport";
import { CoordinateInspector } from "@/src/features/map/components/CoordinateInspector";
import { LayerVisibilityPanel } from "@/src/features/layers/components/LayerVisibilityPanel";
import { TagInformationPanel } from "@/src/features/tracking/components/TagInformationPanel";
import { TagSearchPanel } from "@/src/features/tracking/components/TagSearchPanel";
import { useRealtimeTracking } from "@/src/features/tracking/hooks/useRealtimeTracking";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import { MAP_CALIBRATION, MAP_FLOOR_PLAN } from "@/src/features/map/config/mapConfig";
import { CircleDot, Crosshair, Layers3, Maximize2, Ruler, Scan } from "lucide-react";
import { AnchorManagementPanel } from "@/app/anchors/page";
import { TagManagementPanel } from "@/app/tags/page";
import { SupportContactPanel } from "@/src/features/support/components/SupportContactPanel";
import { RegionManagementPanel } from "@/src/features/regions/components/RegionManagementPanel";
import { GekonAiWidget, type GekonAiContext } from "@/src/features/assistant/components/HistoryChatWidget";
import { resolveLocation } from "@/src/features/map/services/LocationResolverService";

function LiveMapWorkspace({ activeView, onViewChange }: { readonly activeView: WorkspaceView; readonly onViewChange: (view: WorkspaceView) => void }) {
  const { collapsed: sidebarCollapsed, toggleCollapsed: toggleSidebar } = useSidebarCollapse();
  const positionAnimation = useRealtimeTracking();
  const showInspector = useIpsStore((state) => state.showInspector);
  const toggleInspector = useIpsStore((state) => state.toggleInspector);
  const showLayersPanel = useIpsStore((state) => state.showLayersPanel);
  const toggleLayersPanel = useIpsStore((state) => state.toggleLayersPanel);
  const measurementEnabled = useIpsStore((state) => state.measurement.enabled);
  const toggleMeasurement = useIpsStore((state) => state.toggleMeasurement);
  const requestMapFocus = useIpsStore((state) => state.requestMapFocus);
  const tags = useIpsStore((state) => state.tags);
  const selectedTagId = useIpsStore((state) => state.selectedTagId);
  const mapFrameRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [focusFeedback, setFocusFeedback] = useState(false);
  const fullscreenSupported = typeof document === "undefined" || document.fullscreenEnabled;
  const activeTagCount = Object.values(tags).filter((tag) => tag.status === "active").length;
  const selectedTag = selectedTagId ? tags[selectedTagId] : undefined;
  const assistantContext = useMemo<GekonAiContext>(() => ({
    mode: "live",
    selectedTagId: selectedTag?.id,
    tagCode: selectedTag?.id,
    entityName: selectedTag?.name,
    floorPlanId: MAP_FLOOR_PLAN.id,
    floorPlanName: `${MAP_FLOOR_PLAN.name} · ${MAP_FLOOR_PLAN.level}`,
    tagStatus: selectedTag?.status,
    zoneName: selectedTag ? resolveLocation(selectedTag.x, selectedTag.y, MAP_FLOOR_PLAN.id) : undefined,
    livePosition: selectedTag ? {
      x: selectedTag.x,
      y: selectedTag.y,
      observedAt: new Date(selectedTag.timestamp).toISOString(),
    } : undefined,
  }), [selectedTag]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === mapFrameRef.current);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const handleFocus = useCallback(() => {
    requestMapFocus();
    setFocusFeedback(true);
    window.setTimeout(() => setFocusFeedback(false), 450);
  }, [requestMapFocus]);

  const toggleFullscreen = useCallback(async () => {
    const mapFrame = mapFrameRef.current;
    if (!mapFrame || !document.fullscreenEnabled) return;
    try {
      if (document.fullscreenElement === mapFrame) await document.exitFullscreen();
      else await mapFrame.requestFullscreen();
    } catch {
      setIsFullscreen(document.fullscreenElement === mapFrame);
    }
  }, []);

  return (
    <div className={`ips-shell ${activeView !== "map" ? "anchors-mode" : ""}`}>
      <AppHeader sidebarCollapsed={sidebarCollapsed} onSidebarToggle={toggleSidebar} />
      <AppSidebar activeView={activeView} collapsed={sidebarCollapsed} onViewChange={onViewChange} />
      <main className="workspace">
        {activeView === "anchors" ? <AnchorManagementPanel embedded /> : activeView === "tags" ? <TagManagementPanel embedded /> : activeView === "regions" ? <RegionManagementPanel /> : activeView === "support" ? <SupportContactPanel embedded /> : <>
          <div className="workspace-heading">
            <div className="workspace-heading-content">
              <span>CANLI OPERASYONLAR / {MAP_FLOOR_PLAN.level.toUpperCase()}</span>
              <h1>{MAP_FLOOR_PLAN.name}</h1>
            </div>
            <TagSearchPanel />
            <div className="workspace-meta"><i /><span>CANLI KONUMLANDIRMA</span><strong>{activeTagCount} AKTİF</strong></div>
          </div>
          <div ref={mapFrameRef} className="map-frame">
            <MapViewport positionAnimation={positionAnimation} />
            {showInspector && <CoordinateInspector />}
            {showLayersPanel && <LayerVisibilityPanel />}
            <div className="mini-toolbar" aria-label="Harita araçları">
              <button className={showInspector ? "active" : ""} title="Denetçiyi aç/kapat" onClick={toggleInspector}><Crosshair size={16} /></button>
              <button className={showLayersPanel ? "active" : ""} title="Katmanları aç/kapat" onClick={toggleLayersPanel}><Layers3 size={16} /></button>
              <button className={measurementEnabled ? "active" : ""} title="Ölçüm" aria-label="Ölçüm modunu aç veya kapat" aria-pressed={measurementEnabled} onClick={toggleMeasurement}><Ruler size={16} /></button>
              <button className={focusFeedback ? "focus-feedback" : ""} title="Odakla" aria-label="Seçili etikete odaklan" onClick={handleFocus}><Scan size={16} /></button>
              <span />
              <button className={isFullscreen ? "active" : ""} title={isFullscreen ? "Tam ekrandan çık" : "Tam ekran"} aria-label={isFullscreen ? "Tam ekrandan çık" : "Tam ekran"} aria-pressed={isFullscreen} disabled={!fullscreenSupported} onClick={toggleFullscreen}><Maximize2 size={16} /></button>
            </div>
            <div className="map-indicator"><CircleDot size={13} /> PLAN KALİBRE EDİLDİ <span>{MAP_CALIBRATION.pixelsPerMeter} PX/M</span></div>
          </div>
        </>}
      </main>
      {activeView === "map" && <TagInformationPanel />}
      {activeView === "map" && <GekonAiWidget context={assistantContext} />}
      <StatusStrip />
    </div>
  );
}

export function IpsApplication() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } }));
  const [activeView, setActiveView] = useState<Exclude<WorkspaceView, "history">>("map");
  const changeView = (view: WorkspaceView) => {
    if (view === "history") {
      window.location.assign("/history");
      return;
    }
    setActiveView(view);
  };
  return <QueryClientProvider client={queryClient}><HashRouter><LiveMapWorkspace activeView={activeView} onViewChange={changeView} /></HashRouter></QueryClientProvider>;
}
