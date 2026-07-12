"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import { useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { AppSidebar } from "./components/AppSidebar";
import { StatusStrip } from "./components/StatusStrip";
import { MapViewport } from "@/src/features/map/components/MapViewport";
import { CoordinateInspector } from "@/src/features/map/components/CoordinateInspector";
import { LayerVisibilityPanel } from "@/src/features/layers/components/LayerVisibilityPanel";
import { TagInformationPanel } from "@/src/features/tracking/components/TagInformationPanel";
import { useRealtimeTracking } from "@/src/features/tracking/hooks/useRealtimeTracking";
import { DEMO_FLOOR_PLAN } from "@/src/features/map/config/demoMap";
import { CircleDot, Crosshair, Maximize2, Ruler, Scan, Upload } from "lucide-react";

function LiveMapWorkspace() {
  useRealtimeTracking();
  return (
    <div className="ips-shell">
      <AppHeader />
      <AppSidebar />
      <main className="workspace">
        <div className="workspace-heading">
          <div><span>LIVE OPERATIONS / {DEMO_FLOOR_PLAN.level.toUpperCase()}</span><h1>{DEMO_FLOOR_PLAN.name}</h1></div>
          <div className="workspace-meta"><i /><span>LIVE POSITIONING</span><strong>3 ACTIVE</strong></div>
        </div>
        <div className="map-frame">
          <MapViewport />
          <CoordinateInspector />
          <LayerVisibilityPanel />
          <div className="mini-toolbar" aria-label="Map tools">
            <button className="active" title="Select"><Crosshair size={16} /></button>
            <button title="Measure"><Ruler size={16} /></button>
            <button title="Focus"><Scan size={16} /></button>
            <span />
            <button title="Fullscreen"><Maximize2 size={16} /></button>
            <button title="Load floor plan"><Upload size={16} /></button>
          </div>
          <div className="map-indicator"><CircleDot size={13} /> PLAN CALIBRATED <span>30 PX/M</span></div>
        </div>
      </main>
      <TagInformationPanel />
      <StatusStrip />
    </div>
  );
}

export function IpsApplication() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } }));
  return <QueryClientProvider client={queryClient}><HashRouter><LiveMapWorkspace /></HashRouter></QueryClientProvider>;
}
