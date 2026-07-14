import { BarChart3, BellRing, Boxes, Building2, ChevronLeft, Crosshair, Hexagon, Map, RadioTower, Route, Settings } from "lucide-react";

const NAVIGATION = [
  { label: "Live Map", icon: Map, active: true },
  { label: "Tracked Assets", icon: Boxes },
  { label: "Anchors", icon: RadioTower, badge: "06" },
  { label: "Zones", icon: Hexagon },
  { label: "Route History", icon: Route },
  { label: "Alarms", icon: BellRing, badge: "02", alert: true },
  { label: "Analytics", icon: BarChart3 },
];

export type WorkspaceView = "map" | "tags" | "anchors";

interface AppSidebarProps {
  readonly activeView: WorkspaceView;
  readonly onViewChange: (view: WorkspaceView) => void;
}

export function AppSidebar({ activeView, onViewChange }: AppSidebarProps) {
  return (
    <aside className="app-sidebar">
      <nav aria-label="Primary navigation">
        <small>MONITOR</small>
        {NAVIGATION.slice(0, 1).map(({ label, icon: Icon }) => <button key={label} className={activeView === "map" ? "active" : ""} onClick={() => onViewChange("map")}><Icon size={17} /><span>{label}</span></button>)}
        <small>MANAGE</small>
        {NAVIGATION.slice(1, 6).map(({ label, icon: Icon, badge, alert }) => {
          const view = label === "Tracked Assets" ? "tags" : label === "Anchors" ? "anchors" : null;
          return <button key={label} className={view === activeView ? "active" : ""} onClick={view ? () => onViewChange(view) : undefined}><Icon size={17} /><span>{label}</span>{badge && <em className={alert ? "alert" : ""}>{badge}</em>}</button>;
        })}
        <small>INSIGHTS</small>
        {NAVIGATION.slice(6).map(({ label, icon: Icon }) => <button key={label}><Icon size={17} /><span>{label}</span></button>)}
      </nav>
      <div className="sidebar-footer">
        <button><Building2 size={17} /><span>Site settings</span></button>
        <button><Settings size={17} /><span>System</span></button>
        <div className="sidebar-system"><Crosshair size={15} /><div><strong>UWB ENGINE</strong><span><i /> OPERATIONAL</span></div></div>
        <button className="collapse" aria-label="Collapse navigation"><ChevronLeft size={15} /></button>
      </div>
    </aside>
  );
}
