"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, Boxes, Building2, Crosshair, Headset, Hexagon, Map, RadioTower, Route, Settings, X } from "lucide-react";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "ips-sidebar-collapsed";

export type WorkspaceView = "map" | "tags" | "anchors" | "regions" | "history" | "support" | "analyses";

const NAVIGATION: ReadonlyArray<{ readonly label: string; readonly view: WorkspaceView; readonly icon: typeof Map }> = [
  { label: "Canlı Harita", view: "map", icon: Map },
  { label: "İzlenen Varlıklar", view: "tags", icon: Boxes },
  { label: "Referans İstasyonları", view: "anchors", icon: RadioTower },
  { label: "Oda/Bölge", view: "regions", icon: Hexagon },
  { label: "Rota Geçmişi", view: "history", icon: Route },
  { label: "Destek ve İletişim", view: "support", icon: Headset },
];

const REVIEW_NAVIGATION: ReadonlyArray<{ readonly label: string; readonly view: WorkspaceView; readonly icon: typeof Map }> = [{ label: "Analizler", view: "analyses", icon: BarChart3 }];

interface AppSidebarProps {
  readonly activeView: WorkspaceView;
  readonly collapsed: boolean;
  readonly mobileOpen: boolean;
  readonly onMobileClose: () => void;
  readonly onViewChange: (view: WorkspaceView) => void;
}

export function useSidebarCollapse() {
  // A compact sidebar leaves the map with its maximum usable area on a first visit.
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    // Older sessions already persist both "true" and "false" values.  Only an
    // explicit preference to expand the menu should override the compact default.
    if (window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) !== "false") return;
    const restoreExpandedState = window.setTimeout(() => setCollapsed(false), 0);
    return () => window.clearTimeout(restoreExpandedState);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  return { collapsed, toggleCollapsed };
}

export function AppSidebar({ activeView, collapsed, mobileOpen, onMobileClose, onViewChange }: AppSidebarProps) {
  return (
    <aside className={`app-sidebar${collapsed ? " is-collapsed" : ""}${mobileOpen ? " is-mobile-open" : ""}`}>
      <div className="mobile-sidebar-heading">
        <span>MENÜ</span>
        <button type="button" className="mobile-sidebar-close" onClick={onMobileClose} aria-label="Menüyü kapat" title="Menüyü kapat"><X size={18} /></button>
      </div>
      <nav aria-label="Primary navigation">
        <small>İZLE</small>
        {NAVIGATION.slice(0, 1).map(({ label, view, icon: Icon }) => <button key={view} className={activeView === view ? "active" : ""} onClick={() => onViewChange(view)} aria-label={label} title={label}><Icon size={17} /><span>{label}</span></button>)}
        <small>YÖNET</small>
        {NAVIGATION.slice(1).map(({ label, view, icon: Icon }) => <button key={view} className={activeView === view ? "active" : ""} onClick={() => onViewChange(view)} aria-label={label} title={label}><Icon size={17} /><span>{label}</span></button>)}
        <small>İNCELE</small>
        {REVIEW_NAVIGATION.map(({ label, view, icon: Icon }) => <button key={view} className={activeView === view ? "active" : ""} onClick={() => onViewChange(view)} aria-label={label} title={label}><Icon size={17} /><span>{label}</span></button>)}
      </nav>
      <div className="sidebar-footer">
        <button><Building2 size={17} /><span>Saha ayarları</span></button>
        <button><Settings size={17} /><span>Sistem</span></button>
        <div className="sidebar-system"><Crosshair size={15} /><div><strong>UWB MOTORU</strong><span><i /> ÇALIŞIYOR</span></div></div>
      </div>
    </aside>
  );
}
