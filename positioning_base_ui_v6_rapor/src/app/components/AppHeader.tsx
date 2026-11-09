"use client";

import { Check, ChevronDown, CircleUserRound, MapPinned, Menu, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LogoMark } from "@/src/shared/components/LogoMark";
import { groupMapCatalog, isSelectableMap } from "@/src/features/map/services/mapSelection";
import type { MapCatalog, MapCatalogEntry } from "@/src/server/maps/map.types";
import type { UiMode } from "../uiMode";

interface AppHeaderProps {
  readonly mode?: UiMode;
  readonly sidebarCollapsed: boolean;
  readonly mobileMenuOpen: boolean;
  readonly onSidebarToggle: () => void;
  readonly catalog?: MapCatalog;
  readonly activeMapId?: string | null;
  readonly onMapSelect?: (mapId: string) => void;
}

function statusLabel(entry: MapCatalogEntry): string {
  if (entry.liveTrackingEnabled) return "CANLI";
  if (entry.status === "planned") return "PLANLANDI";
  if (entry.status === "disabled") return "DEVRE DIŞI";
  if (entry.status === "preview") return "ÖNİZLEME";
  return "HAZIR";
}

export function AppHeader({ mode = "admin", sidebarCollapsed, mobileMenuOpen, onSidebarToggle, catalog, activeMapId = null, onMapSelect = () => undefined }: AppHeaderProps) {
  const toggleLabel = mobileMenuOpen ? "Menüyü kapat" : sidebarCollapsed ? "Menüyü genişlet" : "Menüyü daralt";
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const activeMap = catalog?.maps.find((entry) => entry.id === activeMapId);
  const groups = useMemo(() => groupMapCatalog(catalog?.maps ?? []), [catalog?.maps]);

  useEffect(() => {
    if (!selectorOpen) return;
    const close = (event: MouseEvent) => {
      if (!selectorRef.current?.contains(event.target as Node)) setSelectorOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectorOpen(false);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectorOpen]);

  return (
    <header className="app-header">
      <div className="brand sidebar-brand-row">
        <LogoMark />
        <div className="sidebar-brand-copy"><strong>GEKON</strong><span>IPS KONTROL</span></div>
        <button type="button" className="sidebar-toggle" aria-label={toggleLabel} aria-expanded={mobileMenuOpen || !sidebarCollapsed} title={toggleLabel} onClick={onSidebarToggle}>
          <Menu size={18} />
        </button>
      </div>
      <div className="site-context map-selector-shell" ref={selectorRef}>
        <button type="button" className="map-selector-trigger" aria-label={activeMap ? `Aktif harita: ${activeMap.displayName}. Kat ve birim seçiciyi aç` : "Kat ve birim seçiciyi aç"} aria-haspopup="dialog" aria-expanded={selectorOpen} disabled={!catalog} onClick={() => setSelectorOpen((open) => !open)}>
          <span className="context-index"><MapPinned size={13} aria-hidden="true" /></span>
          <span className="map-selector-context"><small>BİNA</small><strong>{activeMap?.buildingName ?? "Haritalar yükleniyor"}</strong></span>
          <span className="context-divider" />
          <span className="map-selector-context"><small>KAT / BİRİM</small><strong>{activeMap?.displayName ?? "—"}</strong></span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
        {selectorOpen && catalog && <div className="map-selector-menu" role="dialog" aria-label="Kat ve birim seçimi">
          <div className="map-selector-menu-heading"><small>HASTANE HARİTALARI</small><strong>Kat ve birim seçin</strong></div>
          {groups.map((building) => <section key={building.buildingId} aria-label={building.buildingName}>
            <div className="map-selector-building">{building.buildingName}</div>
            {building.floors.map((floor) => <div className="map-selector-floor" key={floor.floorId}>
              <strong>{floor.floorLabel}</strong>
              <div>{floor.maps.map((entry) => {
                const selectable = isSelectableMap(entry);
                const selected = entry.id === activeMapId;
                const label = statusLabel(entry);
                return <button type="button" key={entry.id} disabled={!selectable} className={selected ? "is-selected" : ""} aria-current={selected ? "true" : undefined} aria-label={`${floor.floorLabel}, ${entry.unitName}, ${label}${selectable ? "" : ", seçilemez"}`} onClick={() => { onMapSelect(entry.id); setSelectorOpen(false); }}>
                  <span>{selected ? <Check size={14} aria-hidden="true" /> : <i aria-hidden="true" />}{entry.unitName}</span>
                  <em>{label}</em>
                </button>;
              })}</div>
            </div>)}
          </section>)}
        </div>}
      </div>
      <div className="header-actions">
        <button aria-label="Ara"><Search size={17} /></button>
        {mode === "admin" && <div className="operator"><CircleUserRound size={24} /><div><strong>Umut Başev</strong><small>KONTROL OPERATÖRÜ</small></div></div>}
      </div>
    </header>
  );
}
