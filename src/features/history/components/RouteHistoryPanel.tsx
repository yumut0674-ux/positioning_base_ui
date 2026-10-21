"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle, CalendarRange, ChevronDown, CircleDot, Clock3, Crosshair, Database, FileText,
  History, Layers3, Loader2, MessageCircle, MapPin, MapPinned, Maximize2, Route, Search,
} from "lucide-react";
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { HistoryChatWidget } from "@/src/features/assistant/components/HistoryChatWidget";
import { RouteReportDialog } from "@/src/features/reports/components/RouteReportDialog";
import { fetchTags, type TagDefinition } from "@/src/features/tracking/services/tagApi";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import { CoordinateTransformService } from "@/src/features/map/services/CoordinateTransformService";
import { buildLocationTimeline, routeDistanceByMap, segmentRouteByMap, type HistoricalPosition, type LocationStay } from "@/src/features/map/services/RouteTimelineService";
import { fetchMapCatalog, fetchMapDetails } from "@/src/features/map/services/mapApi";
import type { MapCatalog, MapDetails } from "@/src/server/maps/map.types";
import type {
  EntityMatch, ErrorEnvelope, RoutePointsHistoryData, SearchEntitiesData, SuccessEnvelope,
} from "@/src/server/location/location.types";
import { useElementSize } from "@/src/shared/hooks/useElementSize";
import { buildDecisionStays } from "../services/decisionTimeline";
import { RouteHistoryImageViewport } from "./RouteHistoryImageViewport";
import styles from "./routeHistoryPanel.module.css";

type HistoryLoadState = "idle" | "loading" | "success" | "no_data" | "unregistered" | "unassigned" | "database_error" | "error";

const MAX_HISTORY_RANGE_MS = 7 * 24 * 60 * 60 * 1_000;

function toLocalInputValue(date: Date): string {
  return new Date(date.getTime() + 3 * 60 * 60 * 1_000).toISOString().slice(0, 16);
}

function initialDateRange(): { readonly from: string; readonly to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 4 * 60 * 60 * 1_000);
  return { from: toLocalInputValue(from), to: toLocalInputValue(to) };
}

function toIstanbulIsoString(value: string): string | undefined {
  const cleaned = value.trim();
  if (!cleaned) return undefined;
  if (/(Z|[+-]\d{2}:\d{2})$/i.test(cleaned)) return cleaned;
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(cleaned) ? `${cleaned}:00` : cleaned;
  return `${withSeconds}+03:00`;
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(new Date(timestamp));
}

function formatDuration(durationMs: number): string {
  const totalMinutes = Math.max(0, Math.round(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} sa${minutes ? ` ${minutes} dk` : ""}` : `${minutes} dk`;
}

function stateMessage(state: HistoryLoadState, customMessage: string | null): string {
  if (customMessage) return customMessage;
  if (state === "idle") return "Varlık ve tarih aralığını seçip gerçek geçmiş verisini sorgulayın.";
  if (state === "no_data") return "Seçilen tarih aralığında konum kaydı bulunamadı.";
  if (state === "unregistered") return "Aranan takip etiketi veya varlık kayıtlı değil. Kayıtsız takip etiketi verileri geçmişe yazılmaz.";
  if (state === "unassigned") return "Bu varlığa seçilen tarih aralığında takip etiketi ataması yapılmamış.";
  if (state === "database_error") return "Geçmiş veritabanına bağlanılamıyor. Bağlantı ve migration durumunu kontrol edin.";
  if (state === "error") return "Geçmiş verisi alınamadı. Lütfen tekrar deneyin.";
  return "";
}

interface RouteHistoryPanelProps {
  readonly requestedTagCode?: string;
  readonly requestKey: number;
}

export const RouteHistoryPanel = memo(function RouteHistoryPanel({ requestedTagCode, requestKey }: RouteHistoryPanelProps) {
  const tagSearchId = useId();
  const tagSearchInputRef = useRef<HTMLInputElement>(null);
  const suppressTagOpenOnFocusRef = useRef(false);
  const mapFrameRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const size = useElementSize(hostRef);
  const [historyMap, setHistoryMap] = useState<MapDetails | null>(null);
  const [mapCatalog, setMapCatalog] = useState<MapCatalog | null>(null);
  const [initialRange] = useState(initialDateRange);
  const [entityQuery, setEntityQuery] = useState(() => requestedTagCode?.trim().toUpperCase() || "");
  const [registeredTags, setRegisteredTags] = useState<TagDefinition[]>([]);
  const [tagListState, setTagListState] = useState<"loading" | "ready" | "error">("loading");
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [tagFilterActive, setTagFilterActive] = useState(false);
  const [entities, setEntities] = useState<readonly EntityMatch[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
  const [entitySearchRequestKey, setEntitySearchRequestKey] = useState(requestKey);
  const [entitySearchLoading, setEntitySearchLoading] = useState(false);
  const [entitySearchError, setEntitySearchError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(initialRange.from);
  const [endDate, setEndDate] = useState(initialRange.to);
  const [positions, setPositions] = useState<HistoricalPosition[]>([]);
  const [historyData, setHistoryData] = useState<RoutePointsHistoryData | null>(null);
  const [historyWarnings, setHistoryWarnings] = useState<readonly string[]>([]);
  const [historyState, setHistoryState] = useState<HistoryLoadState>("idle");
  const [historyMessage, setHistoryMessage] = useState<string | null>(null);
  const [selectedStayId, setSelectedStayId] = useState<string | null>(null);
  const [selectionRequestKey, setSelectionRequestKey] = useState(0);
  const [selectionImage, setSelectionImage] = useState<{ data: RoutePointsHistoryData; stayId: string; mapId: string; url?: string; error?: string } | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: .9 });
  const [assistantDraftRequestId, setAssistantDraftRequestId] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const mapWidth = historyMap?.image.width ?? Math.max(1, size.width);
  const mapHeight = historyMap?.image.height ?? Math.max(1, size.height);
  const historyMapId = historyMap?.id ?? null;
  const historyMapEntry = mapCatalog?.maps.find((map) => map.id === historyMapId);
  const renderedMap = historyData?.renderedMaps?.find(entry => entry.map.id === historyMapId);

  useEffect(() => {
    void fetchMapCatalog().then(setMapCatalog).catch(() => setMapCatalog(null));
  }, []);

  useEffect(() => {
    let active = true;
    const apply = (tags: TagDefinition[]) => { if (active) { setRegisteredTags(tags); setTagListState("ready"); } };
    void fetchTags().then(apply).catch(() => { if (active) setTagListState("error"); });
    const onTagsChanged = (event: Event) => apply((event as CustomEvent<TagDefinition[]>).detail ?? []);
    window.addEventListener("tag-definitions-updated", onTagsChanged);
    return () => { active = false; window.removeEventListener("tag-definitions-updated", onTagsChanged); };
  }, []);

  const visibleTags = useMemo(() => {
    const query = tagFilterActive ? entityQuery.trim().toLocaleLowerCase("tr-TR") : "";
    return query ? registeredTags.filter(tag => `${tag.id} ${tag.displayName}`.toLocaleLowerCase("tr-TR").includes(query)) : registeredTags;
  }, [entityQuery, registeredTags, tagFilterActive]);

  const chooseTag = (tag: TagDefinition) => {
    setEntityQuery(tag.id);
    setTagDropdownOpen(false);
    setTagFilterActive(false);
    setEntitySearchRequestKey(current => current + 1);
    setSelectedEntityId(null);
    setPositions([]);
    setHistoryData(null);
    setHistoryWarnings([]);
    setHistoryState("idle");
    setHistoryMessage(null);
    setSelectedStayId(null);
  };

  useEffect(() => {
    if (historyState !== "success") return;
    const frame = window.requestAnimationFrame(() => {
      const sidebar = sidebarRef.current;
      const summary = summaryRef.current;
      if (!sidebar || !summary) return;
      const summaryTop = summary.getBoundingClientRect().top - sidebar.getBoundingClientRect().top + sidebar.scrollTop;
      const target = Math.max(sidebar.scrollTop, summaryTop - Math.min(140, sidebar.clientHeight * .25));
      sidebar.scrollTo({ top: target, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [historyState]);

  useEffect(() => {
    const requestedTag = requestedTagCode?.trim().toUpperCase();
    if (!requestedTag) return;
    const timer = window.setTimeout(() => {
      setEntityQuery(requestedTag);
      setEntitySearchRequestKey(requestKey);
      setSelectedEntityId(null);
      setPositions([]);
      setHistoryData(null);
      setHistoryWarnings([]);
      setHistoryState("idle");
      setHistoryMessage(null);
      setSelectedStayId(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [requestKey, requestedTagCode]);

  const fitMap = useCallback(() => {
    const padding = 62;
    const scale = Math.max(.02, Math.min(
      (size.width - padding * 2) / mapWidth,
      (size.height - padding * 2) / mapHeight,
    ));
    setViewport({
      scale,
      x: (size.width - mapWidth * scale) / 2,
      y: (size.height - mapHeight * scale) / 2,
    });
  }, [mapHeight, mapWidth, size.height, size.width]);

  useEffect(() => {
    if (size.width <= 1 || size.height <= 1 || selectedStayId) return;
    const frame = window.requestAnimationFrame(fitMap);
    return () => window.cancelAnimationFrame(frame);
  }, [fitMap, size.height, size.width, selectedStayId]);

  useEffect(() => {
    const query = entityQuery.trim();
    if (!query) {
      const timer = window.setTimeout(() => {
        setEntities([]);
        setSelectedEntityId(null);
        setEntitySearchError(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setEntitySearchLoading(true);
      setEntitySearchError(null);
      try {
        const response = await fetch(`/api/location/entities/search?q=${encodeURIComponent(query)}&limit=20`, {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json() as SuccessEnvelope<SearchEntitiesData> | ErrorEnvelope;
        if (!response.ok || "error" in payload) {
          throw new Error("error" in payload ? payload.error.message : "Varlık araması başarısız.");
        }
        setEntities(payload.data.matches);
        setSelectedEntityId((current) => {
          if (payload.data.matches.some((entity) => entity.entityId === current)) return current;
          const exact = payload.data.matches.find((entity) =>
            entity.tagCode?.toUpperCase() === query.toUpperCase()
            || entity.entityCode.toUpperCase() === query.toUpperCase(),
          );
          return (exact ?? payload.data.matches[0])?.entityId ?? null;
        });
        if (payload.data.matches.length === 0) {
          setHistoryState("unregistered");
          setHistoryMessage(null);
          setPositions([]);
          setHistoryData(null);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setEntities([]);
        setSelectedEntityId(null);
        setEntitySearchError(error instanceof Error ? error.message : "Varlık servisine ulaşılamadı.");
        setHistoryState("database_error");
        setHistoryMessage("Varlık kayıtları okunamadı; veritabanı bağlantısını kontrol edin.");
      } finally {
        if (!controller.signal.aborted) setEntitySearchLoading(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [entityQuery, entitySearchRequestKey]);

  const selectedEntity = entities.find((entity) => entity.entityId === selectedEntityId) ?? null;
  const assistantFrom = useMemo(() => toIstanbulIsoString(startDate), [startDate]);
  const assistantTo = useMemo(() => toIstanbulIsoString(endDate), [endDate]);
  const regionsConfigByMapId = useIpsStore((state) => state.regionsConfigByMapId);
  const setRegionsConfig = useIpsStore((state) => state.setRegionsConfig);
  const timeline = useMemo(() => historyData?.zoneTimeline
    ? buildDecisionStays(positions, historyData.zoneTimeline)
    : buildLocationTimeline(positions, "", regionsConfigByMapId), [positions, regionsConfigByMapId, historyData]);
  const distance = useMemo(() => routeDistanceByMap(positions), [positions]);
  const routeSegments = useMemo(() => segmentRouteByMap(positions), [positions]);
  const selectedStay = timeline.find((stay) => stay.id === selectedStayId) ?? null;
  const selectionReady = selectionImage?.data === historyData && selectionImage?.stayId === selectedStay?.id && selectionImage?.mapId === historyMapId;
  const hasSelection = Boolean(selectedStay?.positions.length && selectedStay.mapId === historyMapId);
  const highlightSrc = hasSelection && selectionReady ? selectionImage?.url : undefined;
  const visitedLocationCount = new Set(timeline.filter((stay) => !stay.isDataGap).map((stay) => `${stay.mapId ?? "unresolved"}:${stay.locationLabel}`)).size;
  const totalDuration = historyData?.observedRange ? Date.parse(historyData.observedRange.to) - Date.parse(historyData.observedRange.from)
    : positions.length > 1 ? Date.parse(positions.at(-1)!.timestamp) - Date.parse(positions[0].timestamp) : 0;
  const longestStay = timeline.filter((stay) => !stay.isDataGap).reduce<LocationStay | null>((longest, stay) => !longest || stay.durationMs > longest.durationMs ? stay : longest, null);

  useEffect(() => {
    if (!selectedStay?.mapId || selectedStay.mapId !== historyMapId || !selectedStay.positions.length || !historyData) return;
    const controller = new AbortController();
    const stay = selectedStay, data = historyData, mapId = selectedStay.mapId;
    let objectUrl: string | undefined;
    void fetch("/api/location/history-map/selection", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "image/png" }, signal: controller.signal,
      body: JSON.stringify({ mapId, points: stay.positions.map(({ x, y }) => ({ x, y })), showRoute: !data.zoneTimeline }),
    }).then(async response => {
      if (!response.ok) throw new Error("Seçili bölge görseli hazırlanamadı. Bölgeyi yeniden seçin.");
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setSelectionImage({ data, mapId, stayId: stay.id, url: objectUrl });
    }).catch(error => {
      if (!controller.signal.aborted) setSelectionImage({ data, mapId, stayId: stay.id, error: error instanceof Error ? error.message : "Seçili bölge görseli hazırlanamadı." });
    });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selectedStay, historyMapId, historyData, selectionRequestKey]);

  const fetchHistory = async () => {
    if (historyState === "loading") return;
    if (!selectedEntityId) {
      setHistoryState("unregistered");
      setHistoryMessage("Önce kayıtlı bir takip etiketi veya varlık seçin.");
      return;
    }

    const from = toIstanbulIsoString(startDate);
    const to = toIstanbulIsoString(endDate);
    const fromTime = from ? Date.parse(from) : Number.NaN;
    const toTime = to ? Date.parse(to) : Number.NaN;
    if (!from || !to || !Number.isFinite(fromTime) || !Number.isFinite(toTime)) {
      setHistoryState("error");
      setHistoryMessage("Başlangıç ve bitiş tarihlerini eksiksiz girin.");
      return;
    }
    if (fromTime >= toTime) {
      setHistoryState("error");
      setHistoryMessage("Başlangıç tarihi bitiş tarihinden önce olmalıdır.");
      return;
    }
    if (toTime - fromTime > MAX_HISTORY_RANGE_MS) {
      setHistoryState("error");
      setHistoryMessage("Tarih aralığı en fazla 7 gün olabilir.");
      return;
    }

    setHistoryState("loading");
    setHistoryMessage(null);
    setHistoryWarnings([]);
    setSelectedStayId(null);
    try {
      const query = new URLSearchParams({ from, to, format: "route_points", limit: "2000", render: "map" });
      const response = await fetch(`/api/location/entities/${selectedEntityId}/history?${query}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload = await response.json() as SuccessEnvelope<RoutePointsHistoryData> | ErrorEnvelope;
      if (!response.ok || "error" in payload) {
        const code = "error" in payload ? payload.error.code : "INTERNAL_ERROR";
        if (code === "TAG_ASSIGNMENT_NOT_FOUND") setHistoryState("unassigned");
        else if (code === "ENTITY_NOT_FOUND") setHistoryState("unregistered");
        else if (code === "INTERNAL_ERROR" || code === "UPSTREAM_UNAVAILABLE" || code === "UPSTREAM_TIMEOUT") setHistoryState("database_error");
        else setHistoryState("error");
        setHistoryMessage("error" in payload ? payload.error.message : null);
        setPositions([]);
        setHistoryData(null);
        return;
      }

      const data = payload.data;
      const nextPositions = data.points.map<HistoricalPosition>((point) => ({
        tagId: point.tagCode,
        x: point.x,
        y: point.y,
        timestamp: point.observedAt,
        mapId: point.mapId ?? null,
        sourceZoneId: point.sourceZoneId ?? null,
        sourceZoneName: point.sourceZoneName ?? null,
      }));
      setPositions(nextPositions);
      setHistoryData(data);
      setHistoryWarnings(payload.meta.warnings);
      setHistoryState(nextPositions.length === 0 ? "no_data" : "success");
      const firstMapId = nextPositions.find((position) => position.mapId)?.mapId;
      setHistoryMap(data.renderedMaps?.find(entry => entry.map.id === firstMapId)?.map ?? data.renderedMaps?.[0]?.map ?? null);
      for (const mapId of new Set(nextPositions.flatMap((position) => position.mapId ? [position.mapId] : []))) {
        void fetch(`/api/maps/${encodeURIComponent(mapId)}/regions`, { headers: { Accept: "application/json" }, cache: "no-store" })
          .then(async (regionResponse) => {
            if (!regionResponse.ok) return;
            const regionPayload = await regionResponse.json() as { config: Parameters<typeof setRegionsConfig>[0] };
            setRegionsConfig(regionPayload.config);
          }).catch(() => undefined);
      }
      window.requestAnimationFrame(fitMap);
    } catch (error) {
      setPositions([]);
      setHistoryData(null);
      setHistoryState("database_error");
      setHistoryMessage(error instanceof Error ? error.message : "Geçmiş servisine ulaşılamadı.");
    }
  };

  const focusStay = async (stay: LocationStay) => {
    const map = historyData?.renderedMaps?.find(entry => entry.map.id === stay.mapId)?.map
      ?? (stay.mapId === historyMapId ? historyMap : stay.mapId ? await fetchMapDetails(stay.mapId) : null);
    if (!map) return;
    setHistoryMap(map);
    if (stay.positions.length === 0 || size.width <= 1 || size.height <= 1) return;
    const transform = new CoordinateTransformService(map.calibration);
    const canvasPoints = stay.positions.map(position => transform.worldToCanvas(position));
    const xs = canvasPoints.map(({ x }) => x);
    const ys = canvasPoints.map(({ y }) => y);
    const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
    const padding = 110;
    const scale = Math.min(3.1, Math.max(.38, Math.min(
      (size.width - padding) / Math.max(80, maxX - minX),
      (size.height - padding) / Math.max(80, maxY - minY),
    )));
    setViewport({ scale, x: size.width / 2 - ((minX + maxX) / 2) * scale, y: size.height / 2 - ((minY + maxY) / 2) * scale });
  };

  const chooseStay = (stay: LocationStay) => {
    setSelectedStayId(stay.id);
    setSelectionRequestKey(current => current + 1);
    void focusStay(stay).catch(() => undefined);
  };

  const routePointsForAssistant = useMemo(() => historyData?.zoneTimeline ? undefined : historyData?.points.map((point) => ({
    x: point.x,
    y: point.y,
    observedAt: point.observedAt,
    zoneName: point.zoneName,
    mapId: point.mapId,
    sourceZoneId: point.sourceZoneId,
    sourceZoneName: point.sourceZoneName,
  })), [historyData]);

  return <div className={styles.panelRoot}>
      <div className={`workspace-heading ${styles.historyHeading}`}>
        <div><span>HAREKET ANALİZİ / {(historyMap?.id ?? "KAT BELİRLENEMEDİ").toUpperCase()}</span><h1>Rota Geçmişi</h1></div>
        <button type="button" className={styles.reportButton} onClick={() => setReportOpen(true)}><FileText size={18} aria-hidden="true" />Konum Raporu Oluştur</button>
      </div>
      <div className={styles.historyLayout}>
      <section ref={mapFrameRef} className={styles.mapFrame} aria-label="Rota haritası">
        <div ref={hostRef} className={styles.mapCanvas}>
          <RouteHistoryImageViewport src={renderedMap?.imageDataUrl} highlightSrc={highlightSrc} width={mapWidth} height={mapHeight} viewport={viewport} onViewportChange={setViewport} />
        </div>
        {hasSelection && !highlightSrc && <div className={styles.mapRenderStatus} role="status">{selectionReady && selectionImage?.error ? selectionImage.error : "Seçili bölge hazırlanıyor…"}</div>}
        <div className={styles.vignette} />
        <div className={styles.mapMeta}><CircleDot size={13} /> {historyMap ? "PLAN KALİBRE EDİLDİ" : "KAT BELİRLENEMEDİ"} <span>{historyMap ? `${historyMap.calibration.pixelsPerMeter} PX/M` : "PLAN YOK"} · {routeSegments.length} SEGMENT</span></div>
        <div className={styles.zoomReadout}>{Math.round(viewport.scale * 100)}%</div>
        <div className={styles.mapTools}><button type="button" onClick={fitMap} title="Haritayı sığdır"><Maximize2 size={16} /></button><button type="button" title="Katmanlar"><Layers3 size={16} /></button><button type="button" title="Odak noktası"><Crosshair size={16} /></button></div>
      </section>
        <motion.aside ref={sidebarRef} className={styles.sidebar} initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28 }}>
          <div className={styles.panelHeader}><span className={styles.iconFrame}><History size={18} /></span><div><small>HAREKET ANALİZİ</small><h2>Rota Geçmişi</h2></div></div>
          <p className={styles.intro}>Kayıtlı varlığı ve tarih aralığını seçerek veritabanındaki gerçek hareket akışını inceleyin.</p>
          <div className={styles.fields}>
            <div className={styles.tagSearch} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setTagDropdownOpen(false); }}>
              <label htmlFor={tagSearchId}><span><Search size={13} /> CİHAZ / TAKİP ETİKETİ ARA</span></label>
              <div className={styles.tagSearchInput}><input ref={tagSearchInputRef} id={tagSearchId} type="search" value={entityQuery}
                onChange={event => { setEntityQuery(event.target.value); setTagFilterActive(true); setTagDropdownOpen(true); }}
                onFocus={() => { if (suppressTagOpenOnFocusRef.current) { suppressTagOpenOnFocusRef.current = false; return; } setTagFilterActive(false); setTagDropdownOpen(true); }}
                onClick={() => { setTagFilterActive(false); setTagDropdownOpen(true); }}
                onKeyDown={event => {
                  if (event.key === "Escape") setTagDropdownOpen(false);
                  if (event.key === "Enter" && tagDropdownOpen && visibleTags[0]) { event.preventDefault(); chooseTag(visibleTags[0]); }
                  if (event.key === "ArrowDown") { event.preventDefault(); setTagDropdownOpen(true); window.requestAnimationFrame(() => document.getElementById(`${tagSearchId}-option-0`)?.focus()); }
                }}
                placeholder="Tag adı, kodu veya varlık adı" role="combobox" aria-autocomplete="list" aria-expanded={tagDropdownOpen} aria-controls={`${tagSearchId}-options`} /><ChevronDown size={14} aria-hidden="true" /></div>
              {tagDropdownOpen && <div id={`${tagSearchId}-options`} className={styles.registeredTags} role="listbox" aria-label="Sistemde kayıtlı taglar">
                <div className={styles.registeredTagsTitle}>KAYITLI TAGLAR{tagListState === "ready" ? ` · ${visibleTags.length}` : ""}</div>
                {tagListState === "loading" && <p role="status">Taglar yükleniyor…</p>}
                {tagListState === "error" && <p role="alert">Tag listesi yüklenemedi. Arama alanını kullanabilirsiniz.</p>}
                {tagListState === "ready" && visibleTags.length === 0 && <p>{registeredTags.length ? "Eşleşen tag bulunamadı." : "Kayıtlı tag bulunamadı."}</p>}
                {tagListState === "ready" && visibleTags.length > 0 && <div className={styles.registeredTagList}>{visibleTags.map((tag, index) => <button id={`${tagSearchId}-option-${index}`} key={tag.id} type="button" role="option" aria-selected={entityQuery.trim().toUpperCase() === tag.id.toUpperCase()} onClick={() => chooseTag(tag)} onKeyDown={event => {
                  if (event.key === "Escape") { suppressTagOpenOnFocusRef.current = true; tagSearchInputRef.current?.focus(); setTagDropdownOpen(false); }
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const next = (index + (event.key === "ArrowDown" ? 1 : visibleTags.length - 1)) % visibleTags.length; document.getElementById(`${tagSearchId}-option-${next}`)?.focus(); }
                }}><span>{tag.displayName}</span><code>{tag.id}</code></button>)}</div>}
              </div>}
            </div>
            <label><span><MapPinned size={13} /> İZLENEN VARLIK</span><div className={styles.selectWrap}><select value={selectedEntityId ?? ""} onChange={(event) => { setSelectedEntityId(event.target.value ? Number(event.target.value) : null); setPositions([]); setHistoryData(null); setHistoryState("idle"); setHistoryMessage(null); }} disabled={entitySearchLoading || entities.length === 0}><option value="">{entitySearchLoading ? "Varlıklar aranıyor…" : entities.length ? "Varlık seçin" : "Eşleşen kayıt yok"}</option>{entities.map((entity) => <option key={entity.entityId} value={entity.entityId}>{entity.name} · {entity.tagCode ?? "takip etiketi atanmamış"}</option>)}</select><ChevronDown size={14} /></div></label>
            <div className={styles.dateGrid}><label><span><CalendarRange size={13} /> BAŞLANGIÇ</span><input type="datetime-local" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label><span><Clock3 size={13} /> BİTİŞ</span><input type="datetime-local" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></label></div>
          </div>
          {entitySearchError && <div className={`${styles.statusCard} ${styles.statusError}`}><AlertTriangle size={15} /><span>{entitySearchError}</span></div>}
          <button type="button" className={styles.searchButton} onClick={() => void fetchHistory()} disabled={historyState === "loading" || entitySearchLoading || !selectedEntityId}>{historyState === "loading" ? <Loader2 size={16} className={styles.spin} /> : <Database size={16} />}{historyState === "loading" ? "Gerçek geçmiş aranıyor" : "Geçmişi Getir"}</button>
          <button type="button" className={styles.askAssistantButton} onClick={() => setAssistantDraftRequestId((current) => current + 1)} disabled={!selectedEntity}><MessageCircle size={15} /> Gekon AI’a Sor</button>
          <button type="button" className={`${styles.askAssistantButton} ${styles.mobileMapButton}`} onClick={() => mapFrameRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })}><MapPinned size={15} /> Rota haritasını göster</button>

          {historyState !== "success" && historyState !== "loading" && <div className={`${styles.statusCard} ${historyState === "idle" ? "" : styles.statusError}`}><AlertTriangle size={15} /><span>{stateMessage(historyState, historyMessage)}</span></div>}
          {historyState === "loading" && <div className={styles.statusCard}><Loader2 size={15} className={styles.spin} /><span>Veritabanındaki rota noktaları yükleniyor…</span></div>}
          {historyWarnings.length > 0 && <div className={styles.warningList}>{historyWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
          {historyData?.aggregation ? <div className={styles.sampledNotice}>{historyData.sourcePointCount.toLocaleString("tr-TR")} konum kaydı sunucuda 1 dakikalık X/Y medyanlarıyla {historyData.returnedCount.toLocaleString("tr-TR")} noktaya birleştirildi. Kat ve kaynak bölge geçişleri ayrı tutulur.{historyData.aggregation.pointCountBeforeLimit > historyData.returnedCount ? " Uzun aralık için ek örnekleme uygulandı." : ""}</div>
            : historyData?.sampled && <div className={styles.sampledNotice}>Çok yoğun veri: {historyData.sourcePointCount} kayıttan {historyData.returnedCount} rota noktası örneklendi.</div>}

          {historyState === "success" && <motion.section ref={summaryRef} className={styles.summary} key={positions[0]?.timestamp} initial={{ opacity: .4, y: 5 }} animate={{ opacity: 1, y: 0 }}><div className={styles.summaryTitle}><Route size={14} /><span>ROTA ÖZETİ</span><i>GERÇEK VERİ</i></div><div className={styles.stats}><div><small>BULUNAN NOKTA</small><strong>{positions.length}</strong><em>{historyData?.sourcePointCount ?? positions.length} kaynak kayıt</em></div><div><small>TOPLAM MESAFE</small><strong>{historyData?.zoneTimeline ? "—" : distance.toFixed(1)}{!historyData?.zoneTimeline && <b>m</b>}</strong><em>{historyData?.zoneTimeline ? "Geçiş rotası bilinmiyor" : historyData?.aggregation ? "medyan rotadan yaklaşık" : "ham koordinat toplamı"}</em></div><div><small>ZİYARET EDİLEN BÖLGE</small><strong>{visitedLocationCount}</strong><em>benzersiz alan</em></div><div><small>TOPLAM TAKİP</small><strong>{formatDuration(totalDuration)}</strong><em>veri aralığı</em></div></div></motion.section>}

          {historyState === "success" && <section className={styles.timeline} aria-label="Konum zaman çizelgesi"><div className={styles.timelineHeader}><div className={styles.timelineTitle}><MapPin size={14} /><span>KONUM ZAMAN ÇİZELGESİ</span></div><span className={styles.timelineCount}>{visitedLocationCount} BÖLGE</span></div>{selectedStay && <button type="button" className={styles.showAll} onClick={() => { setSelectedStayId(null); fitMap(); }}>Tüm rotayı göster</button>}<div className={styles.timelineList}>{timeline.map((stay) => <button key={stay.id} type="button" className={`${styles.timelineRow} ${selectedStayId === stay.id ? styles.selectedTimelineRow : ""} ${stay.isDataGap ? styles.gapTimelineRow : ""}`} onClick={() => chooseStay(stay)}><span className={styles.timelineMarker} aria-hidden="true" /><span className={styles.timelineContent}><span className={styles.timelineTime}>{formatTime(stay.startedAt)} — {formatTime(stay.endedAt)} <b>· {formatDuration(stay.durationMs)}</b></span><strong>{stay.locationLabel}</strong><small>{stay.mapId ? mapCatalog?.maps.find((map) => map.id === stay.mapId)?.displayName ?? stay.mapId : "Kat belirlenemedi"}{stay.isMapTransition ? " · Kat geçişi" : ""}</small>{!stay.isDataGap && longestStay?.id === stay.id && <em>EN UZUN KALIŞ</em>}</span></button>)}</div>{longestStay && <p className={styles.longestSummary}>En uzun kalış: <strong>{longestStay.locationLabel}</strong> · {formatDuration(longestStay.durationMs)}</p>}</section>}
          <div className={styles.legend}><span><i className={styles.startDot} /> Başlangıç</span><span><i className={styles.routeDot} /> Rota</span><span><i className={styles.endDot} /> Bitiş</span></div>
        </motion.aside>
      </div>
    {reportOpen && <RouteReportDialog onClose={() => setReportOpen(false)} initialTagCode={selectedEntity?.tagCode ?? undefined} initialFrom={startDate} initialTo={endDate} />}
    <HistoryChatWidget
      tagCode={selectedEntity?.tagCode ?? undefined}
      entityName={selectedEntity?.name}
      from={assistantFrom}
      to={assistantTo}
      floorPlanId={historyMapId ?? undefined}
      floorPlanName={historyMapEntry?.displayName ?? historyMap?.id}
      buildingName={historyMapEntry?.buildingName}
      floorLabel={historyMapEntry?.floorLabel}
      draftText="Seçili etiket en son neredeydi?"
      draftRequestId={assistantDraftRequestId}
      history={historyData && !historyData.zoneTimeline ? {
        returnedCount: historyData.returnedCount,
        sourcePointCount: historyData.sourcePointCount,
        sampled: historyData.sampled,
        distanceMeters: distance,
      } : undefined}
      historyPoints={routePointsForAssistant}
    />
  </div>;
});
