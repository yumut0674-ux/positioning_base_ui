"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { AppSidebar, type WorkspaceView, useSidebarCollapse } from "./components/AppSidebar";
import { StatusStrip } from "./components/StatusStrip";
import { MapViewport } from "@/src/features/map/components/MapViewport";
import { LayerVisibilityPanel } from "@/src/features/layers/components/LayerVisibilityPanel";
import { TagInformationPanel } from "@/src/features/tracking/components/TagInformationPanel";
import { useRealtimeTracking } from "@/src/features/tracking/hooks/useRealtimeTracking";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import { MAP_FLOOR_PLAN } from "@/src/features/map/config/mapConfig";
import { Layers3, Loader2, Maximize2, Ruler, Scan } from "lucide-react";
import { AnchorManagementPanel } from "@/app/anchors/page";
import { TagManagementPanel } from "@/app/tags/page";
import { SupportContactPanel } from "@/src/features/support/components/SupportContactPanel";
import { RegionManagementPanel } from "@/src/features/regions/components/RegionManagementPanel";
import { GekonAiWidget, type GekonAiContext } from "@/src/features/assistant/components/HistoryChatWidget";
import { resolveLocation } from "@/src/features/map/services/LocationResolverService";

const RouteHistoryPanel = dynamic(
  () => import("@/src/features/history/components/RouteHistoryPanel").then((module) => module.RouteHistoryPanel),
  { ssr: false, loading: () => <HistoryPanelLoading /> },
);

interface HistoryRequest {
  readonly tagCode?: string;
  readonly key: number;
}

interface LiveMapWorkspaceProps {
  readonly activeView: WorkspaceView;
  readonly historyOpened: boolean;
  readonly historyRequest: HistoryRequest;
  readonly onOpenTagHistory: (tagCode: string) => void;
  readonly onViewChange: (view: WorkspaceView) => void;
}

function HistoryPanelLoading() {
  return (
    <div className="history-panel-loading" role="status" aria-live="polite">
      <div className="workspace-heading">
        <div><span>HAREKET ANALİZİ / {MAP_FLOOR_PLAN.level.toUpperCase()}</span><h1>Rota Geçmişi</h1></div>
      </div>
      <div className="history-panel-loading-frame">
        <Loader2 size={22} aria-hidden="true" />
        <span>Rota geçmişi hazırlanıyor…</span>
      </div>
    </div>
  );
}

function LiveMapWorkspace({
  activeView,
  historyOpened,
  historyRequest,
  onOpenTagHistory,
  onViewChange,
}: LiveMapWorkspaceProps) {
  const { collapsed: sidebarCollapsed, toggleCollapsed: toggleSidebar } = useSidebarCollapse();
  const positionAnimation = useRealtimeTracking();
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const fullscreenSupported = typeof document === "undefined" || document.fullscreenEnabled;
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

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    const mediaQuery = window.matchMedia("(max-width: 680px)");
    const closeOutsideMobile = () => {
      if (!mediaQuery.matches) setMobileMenuOpen(false);
    };
    document.body.classList.add("mobile-menu-open");
    window.addEventListener("keydown", handleKeyDown);
    mediaQuery.addEventListener("change", closeOutsideMobile);
    return () => {
      document.body.classList.remove("mobile-menu-open");
      window.removeEventListener("keydown", handleKeyDown);
      mediaQuery.removeEventListener("change", closeOutsideMobile);
    };
  }, [mobileMenuOpen]);

  const handleSidebarToggle = useCallback(() => {
    if (window.matchMedia("(max-width: 680px)").matches) {
      setMobileMenuOpen((open) => !open);
      return;
    }
    toggleSidebar();
  }, [toggleSidebar]);

  const handleSidebarViewChange = useCallback((view: WorkspaceView) => {
    setMobileMenuOpen(false);
    onViewChange(view);
  }, [onViewChange]);

  const handleFocus = useCallback(() => {
    requestMapFocus();
    setFocusFeedback(true);
    window.setTimeout(() => setFocusFeedback(false), 450);
  }, [requestMapFocus]);

  const handleShowMap = useCallback(() => {
    requestMapFocus();
    mapFrameRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
      <AppHeader sidebarCollapsed={sidebarCollapsed} mobileMenuOpen={mobileMenuOpen} onSidebarToggle={handleSidebarToggle} />
      {mobileMenuOpen && <button type="button" className="mobile-sidebar-backdrop" aria-label="Menüyü kapat" onClick={() => setMobileMenuOpen(false)} />}
      <AppSidebar activeView={activeView} collapsed={sidebarCollapsed} mobileOpen={mobileMenuOpen} onMobileClose={() => setMobileMenuOpen(false)} onViewChange={handleSidebarViewChange} />
      <main className="workspace">
        {activeView === "anchors" ? <AnchorManagementPanel embedded /> : activeView === "tags" ? <TagManagementPanel embedded /> : activeView === "regions" ? <RegionManagementPanel /> : activeView === "support" ? <SupportContactPanel embedded /> : activeView === "history" ? null : <>
          <div className="workspace-heading live-map-heading">
            <div className="workspace-heading-content">
              <span>CANLI OPERASYONLAR / {MAP_FLOOR_PLAN.level.toUpperCase()}</span>
              <h1>{MAP_FLOOR_PLAN.name}</h1>
            </div>
          </div>
          <TagInformationPanel variant="mobile" onOpenHistory={onOpenTagHistory} onShowMap={handleShowMap} />
          <section className="mobile-map-section" aria-labelledby="mobile-map-title">
            <div className="mobile-map-section-heading"><div><small>CANLI GÖRÜNÜM</small><h2 id="mobile-map-title">Harita</h2></div><span>Haritayı görüntüle</span></div>
            <div ref={mapFrameRef} className="map-frame">
              <MapViewport positionAnimation={positionAnimation} />
              {showLayersPanel && <LayerVisibilityPanel />}
              <div className="mini-toolbar" aria-label="Harita araçları">
                <button className={showLayersPanel ? "active" : ""} title="Katmanları aç/kapat" onClick={toggleLayersPanel}><Layers3 size={16} /></button>
                <button className={measurementEnabled ? "active" : ""} title="Ölçüm" aria-label="Ölçüm modunu aç veya kapat" aria-pressed={measurementEnabled} onClick={toggleMeasurement}><Ruler size={16} /></button>
                <button className={focusFeedback ? "focus-feedback" : ""} title="Odakla" aria-label="Seçili etikete odaklan" onClick={handleFocus}><Scan size={16} /></button>
                <span />
                <button className={isFullscreen ? "active" : ""} title={isFullscreen ? "Tam ekrandan çık" : "Tam ekran"} aria-label={isFullscreen ? "Tam ekrandan çık" : "Tam ekran"} aria-pressed={isFullscreen} disabled={!fullscreenSupported} onClick={toggleFullscreen}><Maximize2 size={16} /></button>
              </div>
            </div>
            <div className="mobile-map-status" role="status"><i /> Kritik durum: canlı tag takibi etkin</div>
          </section>
        </>}
        {historyOpened && (
          <div className="history-panel-slot" hidden={activeView !== "history"}>
            <RouteHistoryPanel requestedTagCode={historyRequest.tagCode} requestKey={historyRequest.key} />
          </div>
        )}
      </main>
      {activeView === "map" && <TagInformationPanel variant="desktop" onOpenHistory={onOpenTagHistory} />}
      {activeView === "map" && <GekonAiWidget context={assistantContext} />}
      <StatusStrip />
    </div>
  );
}

export function IpsApplication() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } }));
  const [activeView, setActiveView] = useState<WorkspaceView>("map");
  const [historyOpened, setHistoryOpened] = useState(false);
  const [historyRequest, setHistoryRequest] = useState<HistoryRequest>({ key: 0 });

  const changeView = useCallback((view: WorkspaceView) => {
    if (view === "history") setHistoryOpened(true);
    setActiveView(view);
  }, []);

  const openTagHistory = useCallback((tagCode: string) => {
    setHistoryOpened(true);
    setHistoryRequest((current) => ({ tagCode, key: current.key + 1 }));
    setActiveView("history");
  }, []);

  return <QueryClientProvider client={queryClient}><HashRouter><LiveMapWorkspace activeView={activeView} historyOpened={historyOpened} historyRequest={historyRequest} onOpenTagHistory={openTagHistory} onViewChange={changeView} /></HashRouter></QueryClientProvider>;
}
