"use client";

import { useEffect, useState } from "react";
import { BarChart3, BellRing, Boxes, Building2, ChevronLeft, ChevronRight, Crosshair, Headset, Hexagon, Map, RadioTower, Route, Settings } from "lucide-react";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "ips-sidebar-collapsed";

const NAVIGATION = [
  { label: "Canlı Harita", icon: Map, active: true },
  { label: "İzlenen Varlıklar", icon: Boxes },
  { label: "Anchors", icon: RadioTower, badge: "06" },
  { label: "Bölgeler", icon: Hexagon },
  { label: "Rota Geçmişi", icon: Route },
  { label: "Destek ve İletişim", icon: Headset },
  { label: "Alarmlar", icon: BellRing, badge: "02", alert: true },
  { label: "Analizler", icon: BarChart3 },
];

export type WorkspaceView = "map" | "tags" | "anchors" | "regions" | "history" | "support";

interface AppSidebarProps {
  readonly activeView: WorkspaceView;
  readonly onViewChange: (view: WorkspaceView) => void;
}

export function AppSidebar({ activeView, onViewChange }: AppSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) !== "true") return;
    const restoreCollapsedState = window.setTimeout(() => setCollapsed(true), 0);
    return () => window.clearTimeout(restoreCollapsedState);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
      return next;
    });
  };

  return (
    <aside className={`app-sidebar${collapsed ? " is-collapsed" : ""}`}>
      <nav aria-label="Primary navigation">
        <small>İZLE</small>
        {NAVIGATION.slice(0, 1).map(({ label, icon: Icon }) => <button key={label} className={activeView === "map" ? "active" : ""} onClick={() => onViewChange("map")}><Icon size={17} /><span>{label}</span></button>)}
        <small>YÖNET</small>
        {NAVIGATION.slice(1, 7).map(({ label, icon: Icon, badge, alert }) => {
          const view = label === "İzlenen Varlıklar" ? "tags" : label === "Anchors" ? "anchors" : label === "Bölgeler" ? "regions" : label === "Rota Geçmişi" ? "history" : label === "Destek ve İletişim" ? "support" : null;
          const onClick = view ? () => onViewChange(view) : undefined;
          return <button key={label} className={view === activeView ? "active" : ""} onClick={onClick}><Icon size={17} /><span>{label}</span>{badge && <em className={alert ? "alert" : ""}>{badge}</em>}</button>;
        })}
        <small>İNCELE</small>
        {NAVIGATION.slice(7).map(({ label, icon: Icon }) => <button key={label}><Icon size={17} /><span>{label}</span></button>)}
      </nav>
      <div className="sidebar-footer">
        <button><Building2 size={17} /><span>Saha ayarları</span></button>
        <button><Settings size={17} /><span>Sistem</span></button>
        <div className="sidebar-system"><Crosshair size={15} /><div><strong>UWB MOTORU</strong><span><i /> ÇALIŞIYOR</span></div></div>
        <button className="collapse" aria-label={collapsed ? "Menüyü genişlet" : "Menüyü daralt"} aria-expanded={!collapsed} title={collapsed ? "Menüyü genişlet" : "Menüyü daralt"} onClick={toggleCollapsed}>{collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}</button>
      </div>
    </aside>
  );
}
