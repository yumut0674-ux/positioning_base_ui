import { BarChart3, BellRing, Boxes, Building2, ChevronLeft, Crosshair, Hexagon, Map, RadioTower, Route, Settings } from "lucide-react";

const NAVIGATION = [
  { label: "Canlı Harita", icon: Map, active: true },
  { label: "İzlenen Varlıklar", icon: Boxes },
  { label: "Anchors", icon: RadioTower, badge: "06" },
  { label: "Bölgeler", icon: Hexagon },
  { label: "Rota Geçmişi", icon: Route },
  { label: "Alarmlar", icon: BellRing, badge: "02", alert: true },
  { label: "Analizler", icon: BarChart3 },
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
        <small>İZLE</small>
        {NAVIGATION.slice(0, 1).map(({ label, icon: Icon }) => <button key={label} className={activeView === "map" ? "active" : ""} onClick={() => onViewChange("map")}><Icon size={17} /><span>{label}</span></button>)}
        <small>YÖNET</small>
        {NAVIGATION.slice(1, 6).map(({ label, icon: Icon, badge, alert }) => {
          const view = label === "İzlenen Varlıklar" ? "tags" : label === "Anchors" ? "anchors" : null;
          return <button key={label} className={view === activeView ? "active" : ""} onClick={view ? () => onViewChange(view) : undefined}><Icon size={17} /><span>{label}</span>{badge && <em className={alert ? "alert" : ""}>{badge}</em>}</button>;
        })}
        <small>İNCELE</small>
        {NAVIGATION.slice(6).map(({ label, icon: Icon }) => <button key={label}><Icon size={17} /><span>{label}</span></button>)}
      </nav>
      <div className="sidebar-footer">
        <button><Building2 size={17} /><span>Saha ayarları</span></button>
        <button><Settings size={17} /><span>Sistem</span></button>
        <div className="sidebar-system"><Crosshair size={15} /><div><strong>UWB MOTORU</strong><span><i /> ÇALIŞIYOR</span></div></div>
        <button className="collapse" aria-label="Menüyü daralt"><ChevronLeft size={15} /></button>
      </div>
    </aside>
  );
}
