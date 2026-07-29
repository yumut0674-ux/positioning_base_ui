import { Bell, ChevronDown, CircleUserRound, Menu, Search } from "lucide-react";
import { MAP_FLOOR_PLAN } from "@/src/features/map/config/mapConfig";
import { LogoMark } from "@/src/shared/components/LogoMark";

interface AppHeaderProps {
  readonly sidebarCollapsed: boolean;
  readonly onSidebarToggle: () => void;
}

export function AppHeader({ sidebarCollapsed, onSidebarToggle }: AppHeaderProps) {
  const toggleLabel = sidebarCollapsed ? "Menüyü genişlet" : "Menüyü daralt";

  return (
    <header className="app-header">
      <div className="brand sidebar-brand-row">
        <LogoMark />
        <div className="sidebar-brand-copy"><strong>GEKON</strong><span>IPS KONTROL</span></div>
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={toggleLabel}
          aria-expanded={!sidebarCollapsed}
          title={toggleLabel}
          onClick={onSidebarToggle}
        >
          <Menu size={18} />
        </button>
      </div>
      <div className="site-context">
        <span className="context-index">01</span>
        <div><small>AKTİF SAHA</small><strong>{MAP_FLOOR_PLAN.building}</strong></div>
        <ChevronDown size={14} />
        <div className="context-divider" />
        <div><small>KAT</small><strong>{MAP_FLOOR_PLAN.level}</strong></div>
        <ChevronDown size={14} />
      </div>
      <div className="header-actions">
        <button aria-label="Ara"><Search size={17} /></button>
        <button aria-label="Bildirimler" className="notification"><Bell size={17} /><i /></button>
        <div className="operator"><CircleUserRound size={24} /><div><strong>Umut Başev</strong><small>KONTROL OPERATÖRÜ</small></div></div>
      </div>
    </header>
  );
}
