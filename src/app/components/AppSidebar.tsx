"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, Boxes, Building2, ClipboardList, Crosshair, Headset, Hexagon, Map, RadioTower, Route, Settings, X } from "lucide-react";
import type { UiMode } from "../uiMode";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "ips-sidebar-collapsed";

export type WorkspaceView = "map" | "tags" | "anchors" | "regions" | "history" | "support" | "analyses" | "room-tests";

type NavigationItem = { readonly label: string; readonly view: WorkspaceView; readonly icon: typeof Map };

const MAP_NAVIGATION: NavigationItem = { label: "Canlı Harita", view: "map", icon: Map };
const HISTORY_NAVIGATION: NavigationItem = { label: "Rota Geçmişi", view: "history", icon: Route };
const SUPPORT_NAVIGATION: NavigationItem = { label: "Destek ve İletişim", view: "support", icon: Headset };
const ADMIN_NAVIGATION: ReadonlyArray<NavigationItem> = [
  { label: "İzlenen Varlıklar", view: "tags", icon: Boxes },
  { label: "Referans İstasyonları", view: "anchors", icon: RadioTower },
  { label: "Oda/Bölge", view: "regions", icon: Hexagon },
];

const REVIEW_NAVIGATION: ReadonlyArray<NavigationItem> = [{ label: "Analizler", view: "analyses", icon: BarChart3 }, { label: "Oda Test Kaydı", view: "room-tests", icon: ClipboardList }];

interface AppSidebarProps {
  readonly mode: UiMode;
  readonly activeView: WorkspaceView;
  readonly collapsed: boolean;
  readonly mobileOpen: boolean;
  readonly onMobileClose: () => void;
  readonly onViewChange: (view: WorkspaceView) => void;
  readonly roomTestRecording?: boolean;
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

export function AppSidebar({ mode, activeView, collapsed, mobileOpen, onMobileClose, onViewChange, roomTestRecording = false }: AppSidebarProps) {
  const item = ({ label, view, icon: Icon }: NavigationItem) => <button key={view} className={`${activeView === view ? "active" : ""}${view === "room-tests" && roomTestRecording ? " room-test-recording" : ""}`} onClick={() => onViewChange(view)} aria-label={`${label}${view === "room-tests" && roomTestRecording ? " · Kayıt açık" : ""}`} title={label}><Icon size={17} /><span>{label}{view === "room-tests" && roomTestRecording ? " · ●" : ""}</span></button>;
  return (
    <aside className={`app-sidebar${collapsed ? " is-collapsed" : ""}${mobileOpen ? " is-mobile-open" : ""}`}>
      <div className="mobile-sidebar-heading">
        <span>MENÜ</span>
        <button type="button" className="mobile-sidebar-close" onClick={onMobileClose} aria-label="Menüyü kapat" title="Menüyü kapat"><X size={18} /></button>
      </div>
      <nav aria-label="Primary navigation">
        <small>İZLE</small>
        {item(MAP_NAVIGATION)}
        {item(HISTORY_NAVIGATION)}
        {mode === "admin" && <><small>YÖNET</small>{ADMIN_NAVIGATION.map(item)}<small>İNCELE</small>{REVIEW_NAVIGATION.map(item)}</>}
        <small>İLETİŞİM</small>
        {item(SUPPORT_NAVIGATION)}
      </nav>
      <div className="sidebar-footer">
        {mode === "admin" && <><button><Building2 size={17} /><span>Saha ayarları</span></button><button><Settings size={17} /><span>Sistem</span></button></>}
        <div className="sidebar-system"><Crosshair size={15} /><div><strong>UWB MOTORU</strong><span><i /> ÇALIŞIYOR</span></div></div>
      </div>
    </aside>
  );
}
