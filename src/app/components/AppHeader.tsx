import { Bell, ChevronDown, CircleUserRound, Search } from "lucide-react";
import { DEMO_FLOOR_PLAN } from "@/src/features/map/config/demoMap";
import { LogoMark } from "@/src/shared/components/LogoMark";

export function AppHeader() {
  return (
    <header className="app-header">
      <div className="brand"><LogoMark /><div><strong>GEKON</strong><span>IPS KONTROL</span></div></div>
      <div className="site-context">
        <span className="context-index">01</span>
        <div><small>AKTİF SAHA</small><strong>{DEMO_FLOOR_PLAN.building}</strong></div>
        <ChevronDown size={14} />
        <div className="context-divider" />
        <div><small>KAT</small><strong>{DEMO_FLOOR_PLAN.level}</strong></div>
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
