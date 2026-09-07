"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle, CalendarRange, ChevronDown, CircleDot, Clock3, Crosshair, Database,
  History, Layers3, Loader2, MessageCircle, MapPin, MapPinned, Maximize2, Route, Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import useImage from "use-image";
import { HistoryChatWidget } from "@/src/features/assistant/components/HistoryChatWidget";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import { MAP_CALIBRATION, MAP_FLOOR_PLAN } from "@/src/features/map/config/mapConfig";
import { CoordinateTransformService } from "@/src/features/map/services/CoordinateTransformService";
import { buildLocationTimeline, type HistoricalPosition, type LocationStay } from "@/src/features/map/services/RouteTimelineService";
import type {
  EntityMatch, ErrorEnvelope, RoutePointsHistoryData, SearchEntitiesData, SuccessEnvelope,
} from "@/src/server/location/location.types";
import { useElementSize } from "@/src/shared/hooks/useElementSize";
import styles from "./routeHistoryPanel.module.css";

type CanvasPoint = readonly [number, number];
type HistoryLoadState = "idle" | "loading" | "success" | "no_data" | "unregistered" | "unassigned" | "database_error" | "error";

const HISTORY_MAP_TRANSFORM = new CoordinateTransformService(MAP_CALIBRATION);
const HISTORY_GRID_STEP = 80;
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

function worldToCanvas(position: Pick<HistoricalPosition, "x" | "y">): CanvasPoint {
  const point = HISTORY_MAP_TRANSFORM.worldToCanvas(position);
  return [point.x, point.y];
}

function routeDistance(positions: readonly HistoricalPosition[]): number {
  return positions.slice(1).reduce((total, position, index) => total + Math.hypot(position.x - positions[index].x, position.y - positions[index].y), 0);
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

export function RouteHistoryPanel({ requestedTagCode, requestKey }: RouteHistoryPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const size = useElementSize(hostRef);
  const [floorImage] = useImage(MAP_FLOOR_PLAN.imageUrl, "anonymous");
  const [initialRange] = useState(initialDateRange);
  const [entityQuery, setEntityQuery] = useState(() => requestedTagCode?.trim().toUpperCase() || "TAG-001");
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
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: .9 });
  const [assistantDraftRequestId, setAssistantDraftRequestId] = useState(0);

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
    const scale = Math.min(
      (size.width - padding * 2) / MAP_FLOOR_PLAN.canvasSize.width,
      (size.height - padding * 2) / MAP_FLOOR_PLAN.canvasSize.height,
    );
    setViewport({
      scale,
      x: (size.width - MAP_FLOOR_PLAN.canvasSize.width * scale) / 2,
      y: (size.height - MAP_FLOOR_PLAN.canvasSize.height * scale) / 2,
    });
  }, [size.height, size.width]);

  useEffect(() => {
    if (size.width <= 1 || size.height <= 1) return;
    const frame = window.requestAnimationFrame(fitMap);
    return () => window.cancelAnimationFrame(frame);
  }, [fitMap, size.height, size.width]);

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
  const regionsConfig = useIpsStore((state) => state.regionsConfig);
  const timeline = useMemo(() => historyData?.zoneTimeline
    ? historyData.zoneTimeline.map((entry, i): LocationStay => ({ id: `decision-${i}`, locationLabel: entry.zoneName, startedAt: entry.enteredAt, endedAt: entry.exitedAt, durationMs: entry.durationSeconds * 1000,
      positions: positions.filter(p => Date.parse(p.timestamp) >= Date.parse(entry.enteredAt) && Date.parse(p.timestamp) <= Date.parse(entry.exitedAt)), isDataGap: entry.zoneName === "Belirsiz" }))
    : buildLocationTimeline(positions, MAP_FLOOR_PLAN.id, regionsConfig), [positions, regionsConfig, historyData]);
  const pointValues = useMemo(() => positions.flatMap((position) => worldToCanvas(position)), [positions]);
  const distance = useMemo(() => routeDistance(positions), [positions]);
  const selectedStay = timeline.find((stay) => stay.id === selectedStayId) ?? null;
  const selectedPointValues = useMemo(() => selectedStay ? selectedStay.positions.flatMap((position) => worldToCanvas(position)) : [], [selectedStay]);
  const startPoint = positions[0] ? worldToCanvas(positions[0]) : undefined;
  const endPoint = positions.at(-1) ? worldToCanvas(positions.at(-1)!) : undefined;
  const visitedLocationCount = new Set(timeline.filter((stay) => !stay.isDataGap).map((stay) => stay.locationLabel)).size;
  const totalDuration = positions.length > 1 ? Date.parse(positions.at(-1)!.timestamp) - Date.parse(positions[0].timestamp) : 0;
  const longestStay = timeline.filter((stay) => !stay.isDataGap).reduce<LocationStay | null>((longest, stay) => !longest || stay.durationMs > longest.durationMs ? stay : longest, null);

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
      const query = new URLSearchParams({ from, to, format: "route_points", limit: "2000" });
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
      }));
      setPositions(nextPositions);
      setHistoryData(data);
      setHistoryWarnings(payload.meta.warnings);
      setHistoryState(nextPositions.length === 0 ? "no_data" : "success");
      window.requestAnimationFrame(fitMap);
    } catch (error) {
      setPositions([]);
      setHistoryData(null);
      setHistoryState("database_error");
      setHistoryMessage(error instanceof Error ? error.message : "Geçmiş servisine ulaşılamadı.");
    }
  };

  const focusStay = (stay: LocationStay) => {
    if (stay.positions.length === 0 || size.width <= 1 || size.height <= 1) return;
    const canvasPoints = stay.positions.map(worldToCanvas);
    const xs = canvasPoints.map(([x]) => x);
    const ys = canvasPoints.map(([, y]) => y);
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
    focusStay(stay);
  };

  const handleWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    const nextScale = Math.min(3.1, Math.max(.38, viewport.scale * (event.evt.deltaY > 0 ? .9 : 1.1)));
    const focusX = (pointer.x - viewport.x) / viewport.scale;
    const focusY = (pointer.y - viewport.y) / viewport.scale;
    setViewport({ scale: nextScale, x: pointer.x - focusX * nextScale, y: pointer.y - focusY * nextScale });
  };

  const routePointsForAssistant = historyData?.zoneTimeline ? undefined : historyData?.points.map((point) => ({
    x: point.x,
    y: point.y,
    observedAt: point.observedAt,
    zoneName: point.zoneName,
  }));

  return <div className={styles.panelRoot}>
      <div className="workspace-heading">
        <div><span>HAREKET ANALİZİ / {MAP_FLOOR_PLAN.level.toUpperCase()}</span><h1>Rota Geçmişi</h1></div>
        <div className="workspace-meta"><i /><span>{historyData?.zoneTimeline ? "ODA KARAR GEÇMİŞİ" : "GERÇEK KONUM VERİSİ"}</span><strong>{selectedEntity?.tagCode ?? selectedEntity?.entityCode ?? "—"}</strong></div>
      </div>
      <section className={styles.mapFrame}>
        <div ref={hostRef} className={styles.mapCanvas}>
          <Stage ref={stageRef} width={size.width} height={size.height} x={viewport.x} y={viewport.y} draggable onWheel={handleWheel} onDragEnd={(event) => setViewport((current) => ({ ...current, x: event.target.x(), y: event.target.y() }))}>
            <Layer listening={false}><Group scaleX={viewport.scale} scaleY={viewport.scale}><Rect width={MAP_FLOOR_PLAN.canvasSize.width} height={MAP_FLOOR_PLAN.canvasSize.height} fill="#e7f0f4" />{floorImage && <KonvaImage image={floorImage} width={MAP_FLOOR_PLAN.canvasSize.width} height={MAP_FLOOR_PLAN.canvasSize.height} opacity={.68} />}<Rect width={MAP_FLOOR_PLAN.canvasSize.width} height={MAP_FLOOR_PLAN.canvasSize.height} fill="#d8f5f0" opacity={.1} /></Group></Layer>
            <Layer listening={false}><Group scaleX={viewport.scale} scaleY={viewport.scale}>{Array.from({ length: Math.ceil(MAP_FLOOR_PLAN.canvasSize.width / HISTORY_GRID_STEP) + 1 }, (_, index) => <Line key={`vertical-${index}`} points={[index * HISTORY_GRID_STEP, 0, index * HISTORY_GRID_STEP, MAP_FLOOR_PLAN.canvasSize.height]} stroke="#6f9db1" strokeWidth={.4} opacity={.16} />)}{Array.from({ length: Math.ceil(MAP_FLOOR_PLAN.canvasSize.height / HISTORY_GRID_STEP) + 1 }, (_, index) => <Line key={`horizontal-${index}`} points={[0, index * HISTORY_GRID_STEP, MAP_FLOOR_PLAN.canvasSize.width, index * HISTORY_GRID_STEP]} stroke="#6f9db1" strokeWidth={.4} opacity={.16} />)}</Group></Layer>
            <Layer listening={false}><Group scaleX={viewport.scale} scaleY={viewport.scale}>
              {!historyData?.zoneTimeline && pointValues.length >= 4 && <><Line points={pointValues} stroke="#00a896" strokeWidth={12} opacity={selectedStay ? .06 : .15} tension={.32} lineCap="round" lineJoin="round" /><Line points={pointValues} stroke="#3578e5" strokeWidth={3.5} opacity={selectedStay ? .2 : .95} tension={.32} lineCap="round" lineJoin="round" shadowColor="#00a896" shadowBlur={12} shadowOpacity={selectedStay ? .12 : .48} /></>}
              {positions.map((position, index) => { const [x, y] = worldToCanvas(position); return <Circle key={`${position.timestamp}-${position.x}`} x={x} y={y} radius={index % 3 === 0 ? 3.5 : 2.2} fill="#ffffff" stroke="#00a896" strokeWidth={1.3} opacity={selectedStay ? .3 : .95} />; })}
              {!historyData?.zoneTimeline && selectedStay && selectedPointValues.length > 2 && <Line points={selectedPointValues} stroke="#00a896" strokeWidth={5} opacity={1} tension={.32} lineCap="round" lineJoin="round" shadowColor="#00a896" shadowBlur={15} shadowOpacity={.5} />}
              {selectedStay?.positions.map((position, index) => { const [x, y] = worldToCanvas(position); return <Circle key={`selected-${position.timestamp}`} x={x} y={y} radius={index === 0 || index === selectedStay.positions.length - 1 ? 6 : 3.2} fill={index === 0 ? "#13a875" : index === selectedStay.positions.length - 1 ? "#3578e5" : "#ffffff"} stroke="#ffffff" strokeWidth={2} />; })}
              {startPoint && <Group x={startPoint[0]} y={startPoint[1]}><Circle radius={14} fill="#21d497" opacity={.19} /><Circle radius={7} fill="#13a875" stroke="#ffffff" strokeWidth={2} /><Text x={15} y={-5} text="BAŞLANGIÇ" fill="#087f73" fontSize={10} fontStyle="bold" fontFamily="Inter, sans-serif" /></Group>}
              {endPoint && <Group x={endPoint[0]} y={endPoint[1]}><Circle radius={16} fill="#f35166" opacity={.19} /><Circle radius={8} fill="#e65353" stroke="#ffffff" strokeWidth={2} /><Text x={16} y={-5} text="BİTİŞ" fill="#bd3e4b" fontSize={10} fontStyle="bold" fontFamily="Inter, sans-serif" /></Group>}
            </Group></Layer>
          </Stage>
        </div>
        <div className={styles.vignette} />
        <div className={styles.mapMeta}><CircleDot size={13} /> PLAN KALİBRE EDİLDİ <span>{MAP_CALIBRATION.pixelsPerMeter} PX/M</span></div>
        <div className={styles.zoomReadout}>{Math.round(viewport.scale * 100)}%</div>
        <div className={styles.mapTools}><button type="button" onClick={fitMap} title="Haritayı sığdır"><Maximize2 size={16} /></button><button type="button" title="Katmanlar"><Layers3 size={16} /></button><button type="button" title="Odak noktası"><Crosshair size={16} /></button></div>
        <motion.aside className={styles.sidebar} initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28 }}>
          <div className={styles.panelHeader}><span className={styles.iconFrame}><History size={18} /></span><div><small>HAREKET ANALİZİ</small><h2>Rota Geçmişi</h2></div></div>
          <p className={styles.intro}>Kayıtlı varlığı ve tarih aralığını seçerek veritabanındaki gerçek hareket akışını inceleyin.</p>
          <div className={styles.fields}>
            <label><span><Search size={13} /> CİHAZ / TAKİP ETİKETİ ARA</span><input value={entityQuery} onChange={(event) => setEntityQuery(event.target.value)} placeholder="Takip etiketi kodu veya varlık adı" /></label>
            <label><span><MapPinned size={13} /> İZLENEN VARLIK</span><div className={styles.selectWrap}><select value={selectedEntityId ?? ""} onChange={(event) => { setSelectedEntityId(event.target.value ? Number(event.target.value) : null); setPositions([]); setHistoryData(null); setHistoryState("idle"); setHistoryMessage(null); }} disabled={entitySearchLoading || entities.length === 0}><option value="">{entitySearchLoading ? "Varlıklar aranıyor…" : entities.length ? "Varlık seçin" : "Eşleşen kayıt yok"}</option>{entities.map((entity) => <option key={entity.entityId} value={entity.entityId}>{entity.name} · {entity.tagCode ?? "takip etiketi atanmamış"}</option>)}</select><ChevronDown size={14} /></div></label>
            <div className={styles.dateGrid}><label><span><CalendarRange size={13} /> BAŞLANGIÇ</span><input type="datetime-local" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label><span><Clock3 size={13} /> BİTİŞ</span><input type="datetime-local" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></label></div>
          </div>
          {entitySearchError && <div className={`${styles.statusCard} ${styles.statusError}`}><AlertTriangle size={15} /><span>{entitySearchError}</span></div>}
          <button type="button" className={styles.searchButton} onClick={() => void fetchHistory()} disabled={historyState === "loading" || entitySearchLoading || !selectedEntityId}>{historyState === "loading" ? <Loader2 size={16} className={styles.spin} /> : <Database size={16} />}{historyState === "loading" ? "Gerçek geçmiş aranıyor" : "Geçmişi Getir"}</button>
          <button type="button" className={styles.askAssistantButton} onClick={() => setAssistantDraftRequestId((current) => current + 1)} disabled={!selectedEntity}><MessageCircle size={15} /> Gekon AI’a Sor</button>

          {historyState !== "success" && historyState !== "loading" && <div className={`${styles.statusCard} ${historyState === "idle" ? "" : styles.statusError}`}><AlertTriangle size={15} /><span>{stateMessage(historyState, historyMessage)}</span></div>}
          {historyState === "loading" && <div className={styles.statusCard}><Loader2 size={15} className={styles.spin} /><span>Veritabanındaki rota noktaları yükleniyor…</span></div>}
          {historyWarnings.length > 0 && <div className={styles.warningList}>{historyWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
          {historyData?.sampled && <div className={styles.sampledNotice}>Çok yoğun veri: {historyData.sourcePointCount} kayıttan {historyData.returnedCount} rota noktası örneklendi.</div>}

          {historyState === "success" && <motion.section className={styles.summary} key={positions[0]?.timestamp} initial={{ opacity: .4, y: 5 }} animate={{ opacity: 1, y: 0 }}><div className={styles.summaryTitle}><Route size={14} /><span>ROTA ÖZETİ</span><i>GERÇEK VERİ</i></div><div className={styles.stats}><div><small>BULUNAN NOKTA</small><strong>{positions.length}</strong><em>{historyData?.sourcePointCount ?? positions.length} kaynak kayıt</em></div><div><small>TOPLAM MESAFE</small><strong>{historyData?.zoneTimeline ? "—" : distance.toFixed(1)}{!historyData?.zoneTimeline && <b>m</b>}</strong><em>{historyData?.zoneTimeline ? "Geçiş rotası bilinmiyor" : "ham koordinat toplamı"}</em></div><div><small>ZİYARET EDİLEN BÖLGE</small><strong>{visitedLocationCount}</strong><em>benzersiz alan</em></div><div><small>TOPLAM TAKİP</small><strong>{formatDuration(totalDuration)}</strong><em>veri aralığı</em></div></div></motion.section>}

          {historyState === "success" && <section className={styles.timeline} aria-label="Konum zaman çizelgesi"><div className={styles.timelineHeader}><div className={styles.timelineTitle}><MapPin size={14} /><span>KONUM ZAMAN ÇİZELGESİ</span></div><span className={styles.timelineCount}>{visitedLocationCount} BÖLGE</span></div>{selectedStay && <button type="button" className={styles.showAll} onClick={() => { setSelectedStayId(null); fitMap(); }}>Tüm rotayı göster</button>}<div className={styles.timelineList}>{timeline.map((stay) => <button key={stay.id} type="button" className={`${styles.timelineRow} ${selectedStayId === stay.id ? styles.selectedTimelineRow : ""} ${stay.isDataGap ? styles.gapTimelineRow : ""}`} onClick={() => chooseStay(stay)}><span className={styles.timelineMarker} aria-hidden="true" /><span className={styles.timelineContent}><span className={styles.timelineTime}>{formatTime(stay.startedAt)} — {formatTime(stay.endedAt)} <b>· {formatDuration(stay.durationMs)}</b></span><strong>{stay.locationLabel}</strong>{!stay.isDataGap && longestStay?.id === stay.id && <em>EN UZUN KALIŞ</em>}</span></button>)}</div>{longestStay && <p className={styles.longestSummary}>En uzun kalış: <strong>{longestStay.locationLabel}</strong> · {formatDuration(longestStay.durationMs)}</p>}</section>}
          <div className={styles.legend}><span><i className={styles.startDot} /> Başlangıç</span><span><i className={styles.routeDot} /> Rota</span><span><i className={styles.endDot} /> Bitiş</span></div>
        </motion.aside>
      </section>
    <HistoryChatWidget
      tagCode={selectedEntity?.tagCode ?? undefined}
      entityName={selectedEntity?.name}
      from={assistantFrom}
      to={assistantTo}
      floorPlanId={MAP_FLOOR_PLAN.id}
      draftText={selectedEntity?.name}
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
}
