"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import { useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { AppSidebar, type WorkspaceView } from "./components/AppSidebar";
import { StatusStrip } from "./components/StatusStrip";
import { MapViewport } from "@/src/features/map/components/MapViewport";
import { CoordinateInspector } from "@/src/features/map/components/CoordinateInspector";
import { LayerVisibilityPanel } from "@/src/features/layers/components/LayerVisibilityPanel";
import { TagInformationPanel } from "@/src/features/tracking/components/TagInformationPanel";
import { useRealtimeTracking } from "@/src/features/tracking/hooks/useRealtimeTracking";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import { DEMO_FLOOR_PLAN } from "@/src/features/map/config/demoMap";
import { CircleDot, Crosshair, Layers3, Maximize2, Ruler, Scan, Upload } from "lucide-react";
import { AnchorManagementPanel } from "@/app/anchors/page";

function LiveMapWorkspace({ activeView, onViewChange }: { readonly activeView: WorkspaceView; readonly onViewChange: (view: WorkspaceView) => void }) {
  useRealtimeTracking();
  const showInspector = useIpsStore((state) => state.showInspector);
  const toggleInspector = useIpsStore((state) => state.toggleInspector);
  const showLayersPanel = useIpsStore((state) => state.showLayersPanel);
  const toggleLayersPanel = useIpsStore((state) => state.toggleLayersPanel);
  return (
    <div className={`ips-shell ${activeView === "anchors" ? "anchors-mode" : ""}`}>
      <AppHeader />
      <AppSidebar activeView={activeView} onViewChange={onViewChange} />
      <main className="workspace">
        {activeView === "anchors" ? <AnchorManagementPanel embedded /> : <>
          <div className="workspace-heading">
            <div><span>LIVE OPERATIONS / {DEMO_FLOOR_PLAN.level.toUpperCase()}</span><h1>{DEMO_FLOOR_PLAN.name}</h1></div>
            <div className="workspace-meta"><i /><span>LIVE POSITIONING</span><strong>3 ACTIVE</strong></div>
          </div>
          <div className="map-frame">
            <MapViewport />
            {showInspector && <CoordinateInspector />}
            {showLayersPanel && <LayerVisibilityPanel />}
            <div className="mini-toolbar" aria-label="Map tools">
              <button className={showInspector ? "active" : ""} title="Toggle Inspector" onClick={toggleInspector}><Crosshair size={16} /></button>
              <button className={showLayersPanel ? "active" : ""} title="Toggle Layers" onClick={toggleLayersPanel}><Layers3 size={16} /></button>
              <button title="Measure"><Ruler size={16} /></button>
              <button title="Focus"><Scan size={16} /></button>
              <span />
              <button title="Fullscreen"><Maximize2 size={16} /></button>
              <button title="Load floor plan"><Upload size={16} /></button>
            </div>
            <div className="map-indicator"><CircleDot size={13} /> PLAN CALIBRATED <span>30 PX/M</span></div>
          </div>
        </>}
      </main>
      {activeView === "map" && <TagInformationPanel />}
      <StatusStrip />
    </div>
  );
}

export function IpsApplication() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } }));
  const [activeView, setActiveView] = useState<WorkspaceView>("map");
  return <QueryClientProvider client={queryClient}><HashRouter><LiveMapWorkspace activeView={activeView} onViewChange={setActiveView} /></HashRouter></QueryClientProvider>;
}
