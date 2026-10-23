"use client";
import { useEffect, useState } from "react";
import type { AreaTransitionEvent } from "@/src/server/regionEngine/AreaTransitionEngine";
import type { RegionEngineStatusResponse } from "@/src/features/regions/services/regionEngineApi";
import { AREA_EVENT_LABELS as labels } from "../services/areaEventLabels";
import styles from "./areaEventLogs.module.css";

export function AreaEventLogs() {
  const [filters, setFilters] = useState({ tagCode: "", mapId: "", areaId: "", type: "", from: "", to: "" });
  const [activeFilters, setActiveFilters] = useState(filters);
  const [items, setItems] = useState<AreaTransitionEvent[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [areaStatus, setAreaStatus] = useState<RegionEngineStatusResponse["areaTracking"]>();
  useEffect(() => {
    const params = new URLSearchParams(Object.entries(activeFilters).filter(([, value]) => value)
      .map(([key, value]) => [key, (key === "from" || key === "to") ? new Date(value).toISOString() : value]));
    params.set("limit", "500");
    let active = true;
    void fetch(`/api/area-events?${params}`, { cache: "no-store" }).then(async response => {
      const body = await response.json() as { items?: AreaTransitionEvent[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Alan olayları okunamadı");
      if (active) { setItems(body.items ?? []); setError(""); }
    }).catch(caught => { if (active) setError(caught instanceof Error ? caught.message : "Alan olayları okunamadı"); });
    void fetch("/api/region-engine/status", { cache: "no-store" }).then(async response => {
      if (response.ok && active) setAreaStatus((await response.json() as RegionEngineStatusResponse).areaTracking);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [activeFilters, revision]);
  const apply = () => {
    if ((filters.from && !Number.isFinite(Date.parse(filters.from))) || (filters.to && !Number.isFinite(Date.parse(filters.to))) ||
        (filters.from && filters.to && Date.parse(filters.from) > Date.parse(filters.to))) {
      setError("Tarih aralığı geçersiz."); return;
    }
    setError(""); setActiveFilters({ ...filters }); setRevision(value => value + 1);
  };
  return <section aria-label="Büyük alan giriş çıkış olayları" className={styles.panel}>
    <h2>Büyük alan giriş/çıkış olayları</h2>
    {areaStatus && <div className={styles.diagnostics}>
      <strong>Alan takip durumu</strong>
      <span>Veritabanı kuyruğu: {areaStatus.pendingWrites} (olay {areaStatus.queuedEvents}, durum {areaStatus.queuedStates}) · Birleştirilen durum: {areaStatus.coalescedStateWrites} · Düşürülen: {areaStatus.droppedRecords} · Reddedilen: {areaStatus.rejectedWrites}</span>
      {areaStatus.error && <span role="alert">Son yazım hatası: {areaStatus.error}</span>}
      {Object.entries(areaStatus.sourceHealth).map(([mapId, health]) => <span key={mapId}>{mapId}: kaynak {health === "healthy" ? "sağlıklı" : health === "outage" ? "kesintide" : "sağlığı bilinmiyor"}</span>)}
      {areaStatus.pendingExits.map(item => <span key={`${item.tagCode}/${item.mapId}/${item.areaId}`}>
        Bekleyen çıkış · {item.tagCode} · {item.mapId}/{item.areaId} · {item.reason} Son ölçüm: {new Date(item.lastMeasuredAt).toLocaleString("tr-TR")}
      </span>)}
    </div>}
    <div className={styles.filters}>
      {(["tagCode", "mapId", "areaId"] as const).map(field => <label key={field}>{field === "tagCode" ? "Tag" : field === "mapId" ? "Harita" : "Alan"}
        <input value={filters[field]} onChange={event => setFilters(current => ({ ...current, [field]: event.target.value }))} /></label>)}
      <label>Olay türü<select value={filters.type} onChange={event => setFilters(current => ({ ...current, type: event.target.value }))}>
        <option value="">Tümü</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Başlangıç<input type="datetime-local" value={filters.from} onChange={event => setFilters(current => ({ ...current, from: event.target.value }))} /></label>
      <label>Bitiş<input type="datetime-local" value={filters.to} onChange={event => setFilters(current => ({ ...current, to: event.target.value }))} /></label>
      <button type="button" onClick={apply}>Uygula / yenile</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {!error && !items.length && <p className={styles.empty}>Bu aralıkta alan geçişi bulunamadı.</p>}
    <div role="list" className={styles.list}>{items.map(item => <article role="listitem" key={item.id} className={styles.event}>
      <strong>{labels[item.type]}</strong> · {item.tagCode} · {item.areaName} ({item.areaId}) · {item.mapId}
      <div>Geçiş bölgesi: {item.gateId ?? "Kat geçişi"} · {item.observed ? "Gözlemlendi" : "Tahmini"}</div>
      <div>Son güvenilir ölçüm: {new Date(item.lastMeasuredAt).toLocaleString("tr-TR")} · Karar: {new Date(item.decidedAt).toLocaleString("tr-TR")}</div>
      <div>{item.reason}</div>{item.transitionId && <small>İlişkili kat geçişi: {item.transitionId}</small>}
    </article>)}</div>
  </section>;
}
