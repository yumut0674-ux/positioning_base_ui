"use client";

import { motion } from "framer-motion";
import { CalendarRange, ChevronDown, CircleDot, Clock3, Crosshair, History, Layers3, Loader2, MapPin, MapPinned, Maximize2, Route, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import useImage from "use-image";
import { AppHeader } from "@/src/app/components/AppHeader";
import { AppSidebar, type WorkspaceView } from "@/src/app/components/AppSidebar";
import { StatusStrip } from "@/src/app/components/StatusStrip";
import { DEMO_FLOOR_PLAN } from "@/src/features/map/config/demoMap";
import { buildLocationTimeline, type HistoricalPosition, type LocationStay } from "@/src/features/map/services/RouteTimelineService";
import { useElementSize } from "@/src/shared/hooks/useElementSize";
import styles from "./history.module.css";

type CanvasPoint = readonly [number, number];

const TAG_OPTIONS = [{ id: "TAG-001", name: "Forklift 07" }, { id: "TAG-014", name: "Personel A14" }, { id: "TAG-028", name: "Palet 28" }];
const BASE_ROUTE: readonly { readonly x: number; readonly y: number; readonly minute: number }[] = [
  { x: 6.1, y: 5.9, minute: 0 }, { x: 7.5, y: 6.7, minute: 4 }, { x: 9.0, y: 7.5, minute: 8 }, { x: 10.6, y: 7.1, minute: 12 }, { x: 11.9, y: 8.2, minute: 16 }, { x: 13.6, y: 9.1, minute: 20 },
  { x: 15.1, y: 9.7, minute: 24 }, { x: 16.4, y: 10.4, minute: 28 }, { x: 18.2, y: 11.2, minute: 32 }, { x: 19.6, y: 12.2, minute: 36 }, { x: 21.4, y: 12.4, minute: 40 }, { x: 23.0, y: 12.8, minute: 44 },
  { x: 25.4, y: 14.5, minute: 48 }, { x: 27.2, y: 15.0, minute: 52 }, { x: 29.2, y: 15.1, minute: 56 }, { x: 31.0, y: 15.6, minute: 60 }, { x: 33.0, y: 16.0, minute: 64 }, { x: 34.8, y: 15.3, minute: 68 },
  { x: 32.2, y: 13.4, minute: 75 }, { x: 30.0, y: 13.1, minute: 79 }, { x: 26.0, y: 13.0, minute: 83 }, { x: 22.0, y: 12.8, minute: 87 },
];

function parseLocalDate(value: string): number {
  return new Date(`${value}:00+03:00`).getTime();
}

function readRequestedTag(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("tag")?.trim().toUpperCase() || null;
}

function worldToCanvas(position: Pick<HistoricalPosition, "x" | "y">): CanvasPoint {
  return [position.x * 30, DEMO_FLOOR_PLAN.canvasSize.height - position.y * 30];
}

function buildHistory(tagId: string, startDate: string, endDate: string, seed: number): HistoricalPosition[] {
  const startTime = parseLocalDate(startDate);
  const endTime = parseLocalDate(endDate);
  return BASE_ROUTE
    .map((point, index) => ({
      tagId,
      x: point.x + Math.sin(seed + index * .73) * .12,
      y: point.y + Math.cos(seed * .6 + index * .45) * .1,
      timestamp: new Date(startTime + point.minute * 60_000).toISOString(),
      battery: Math.max(54, 94 - index * 1.3),
    }))
    .filter((position) => Number.isFinite(endTime) && new Date(position.timestamp).getTime() <= endTime);
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

export default function HistoryPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const size = useElementSize(hostRef);
  const [floorImage] = useImage(DEMO_FLOOR_PLAN.imageUrl, "anonymous");
  const [requestedTag] = useState(readRequestedTag);
  const [selectedTag, setSelectedTag] = useState(() => readRequestedTag() ?? TAG_OPTIONS[0].id);
  const [startDate, setStartDate] = useState("2026-07-15T08:00");
  const [endDate, setEndDate] = useState("2026-07-15T12:00");
  const [positions, setPositions] = useState<HistoricalPosition[]>(() => buildHistory(TAG_OPTIONS[0].id, "2026-07-15T08:00", "2026-07-15T12:00", .4));
  const [loading, setLoading] = useState(false);
  const [selectedStayId, setSelectedStayId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: .9 });

  const fitMap = useCallback(() => {
    const padding = 62;
    const scale = Math.min((size.width - padding * 2) / DEMO_FLOOR_PLAN.canvasSize.width, (size.height - padding * 2) / DEMO_FLOOR_PLAN.canvasSize.height);
    setViewport({ scale, x: (size.width - DEMO_FLOOR_PLAN.canvasSize.width * scale) / 2, y: (size.height - DEMO_FLOOR_PLAN.canvasSize.height * scale) / 2 });
  }, [size.height, size.width]);

  useEffect(() => {
    if (size.width <= 1 || size.height <= 1) return;
    const frame = window.requestAnimationFrame(fitMap);
    return () => window.cancelAnimationFrame(frame);
  }, [fitMap, size.height, size.width]);

  const tagOptions = requestedTag && !TAG_OPTIONS.some((tag) => tag.id === requestedTag) ? [...TAG_OPTIONS, { id: requestedTag, name: "Seçili Tag" }] : TAG_OPTIONS;
  const activeTag = tagOptions.find((tag) => tag.id === selectedTag) ?? tagOptions[0];
  const timeline = useMemo(() => buildLocationTimeline(positions, DEMO_FLOOR_PLAN.id), [positions]);
  const pointValues = useMemo(() => positions.flatMap((position) => worldToCanvas(position)), [positions]);
  const distance = useMemo(() => routeDistance(positions), [positions]);
  const selectedStay = timeline.find((stay) => stay.id === selectedStayId) ?? null;
  const selectedPointValues = useMemo(() => selectedStay ? selectedStay.positions.flatMap((position) => worldToCanvas(position)) : [], [selectedStay]);
  const startPoint = positions[0] ? worldToCanvas(positions[0]) : undefined;
  const endPoint = positions.at(-1) ? worldToCanvas(positions.at(-1)!) : undefined;
  const visitedLocationCount = new Set(timeline.filter((stay) => !stay.isDataGap).map((stay) => stay.locationLabel)).size;
  const totalDuration = positions.length > 1 ? new Date(positions.at(-1)!.timestamp).getTime() - new Date(positions[0].timestamp).getTime() : 0;
  const longestStay = timeline.filter((stay) => !stay.isDataGap).reduce<LocationStay | null>((longest, stay) => !longest || stay.durationMs > longest.durationMs ? stay : longest, null);

  const refreshHistory = (tagId: string, nextStartDate: string, nextEndDate: string, seed = Date.now() / 1300) => {
    setPositions(buildHistory(tagId, nextStartDate, nextEndDate, seed));
    setSelectedStayId(null);
  };
  const fetchHistory = () => {
    if (loading) return;
    setLoading(true);
    window.setTimeout(() => {
      refreshHistory(selectedTag, startDate, endDate);
      setLoading(false);
    }, 700);
  };
  const focusStay = (stay: LocationStay) => {
    if (stay.positions.length === 0 || size.width <= 1 || size.height <= 1) return;
    const canvasPoints = stay.positions.map(worldToCanvas);
    const xs = canvasPoints.map(([x]) => x);
    const ys = canvasPoints.map(([, y]) => y);
    const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
    const padding = 110;
    const scale = Math.min(3.1, Math.max(.38, Math.min((size.width - padding) / Math.max(80, maxX - minX), (size.height - padding) / Math.max(80, maxY - minY))));
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
  const changeView = (view: WorkspaceView) => { if (view !== "history") window.location.assign("/"); };

  return <div className="ips-shell anchors-mode">
    <AppHeader />
    <AppSidebar activeView="history" onViewChange={changeView} />
    <main className={`workspace ${styles.workspace}`}>
      <div className="workspace-heading">
        <div><span>HAREKET ANALİZİ / {DEMO_FLOOR_PLAN.level.toUpperCase()}</span><h1>Rota Geçmişi</h1></div>
        <div className="workspace-meta"><i /><span>GEÇMİŞ KONUM VERİSİ</span><strong>{activeTag.id}</strong></div>
      </div>
      <section className={styles.mapFrame}>
        <div ref={hostRef} className={styles.mapCanvas}>
          <Stage ref={stageRef} width={size.width} height={size.height} x={viewport.x} y={viewport.y} draggable onWheel={handleWheel} onDragEnd={(event) => setViewport((current) => ({ ...current, x: event.target.x(), y: event.target.y() }))}>
            <Layer listening={false}><Group scaleX={viewport.scale} scaleY={viewport.scale}><Rect width={1280} height={720} fill="#e7f0f4" />{floorImage && <KonvaImage image={floorImage} width={1280} height={720} opacity={.68} />}<Rect width={1280} height={720} fill="#d8f5f0" opacity={.1} /></Group></Layer>
            <Layer listening={false}><Group scaleX={viewport.scale} scaleY={viewport.scale}>{Array.from({ length: 17 }, (_, index) => <Line key={`vertical-${index}`} points={[index * 80, 0, index * 80, 720]} stroke="#6f9db1" strokeWidth={.4} opacity={.16} />)}{Array.from({ length: 10 }, (_, index) => <Line key={`horizontal-${index}`} points={[0, index * 80, 1280, index * 80]} stroke="#6f9db1" strokeWidth={.4} opacity={.16} />)}</Group></Layer>
            <Layer listening={false}><Group scaleX={viewport.scale} scaleY={viewport.scale}>
              <Line points={pointValues} stroke="#00a896" strokeWidth={12} opacity={selectedStay ? .06 : .15} tension={.32} lineCap="round" lineJoin="round" />
              <Line points={pointValues} stroke="#3578e5" strokeWidth={3.5} opacity={selectedStay ? .2 : .95} tension={.32} lineCap="round" lineJoin="round" shadowColor="#00a896" shadowBlur={12} shadowOpacity={selectedStay ? .12 : .48} />
              {positions.map((position, index) => { const [x, y] = worldToCanvas(position); return <Circle key={`${position.timestamp}-${position.x}`} x={x} y={y} radius={index % 3 === 0 ? 3.5 : 2.2} fill="#ffffff" stroke="#00a896" strokeWidth={1.3} opacity={selectedStay ? .3 : .95} />; })}
              {selectedStay && selectedPointValues.length > 2 && <Line points={selectedPointValues} stroke="#00a896" strokeWidth={5} opacity={1} tension={.32} lineCap="round" lineJoin="round" shadowColor="#00a896" shadowBlur={15} shadowOpacity={.5} />}
              {selectedStay?.positions.map((position, index) => { const [x, y] = worldToCanvas(position); return <Circle key={`selected-${position.timestamp}`} x={x} y={y} radius={index === 0 || index === selectedStay.positions.length - 1 ? 6 : 3.2} fill={index === 0 ? "#13a875" : index === selectedStay.positions.length - 1 ? "#3578e5" : "#ffffff"} stroke="#ffffff" strokeWidth={2} />; })}
              {startPoint && <Group x={startPoint[0]} y={startPoint[1]}><Circle radius={14} fill="#21d497" opacity={.19} /><Circle radius={7} fill="#13a875" stroke="#ffffff" strokeWidth={2} /><Text x={15} y={-5} text="BAŞLANGIÇ" fill="#087f73" fontSize={10} fontStyle="bold" fontFamily="Inter, sans-serif" /></Group>}
              {endPoint && <Group x={endPoint[0]} y={endPoint[1]}><Circle radius={16} fill="#f35166" opacity={.19} /><Circle radius={8} fill="#e65353" stroke="#ffffff" strokeWidth={2} /><Text x={16} y={-5} text="BİTİŞ" fill="#bd3e4b" fontSize={10} fontStyle="bold" fontFamily="Inter, sans-serif" /></Group>}
            </Group></Layer>
          </Stage>
        </div>
        <div className={styles.vignette} />
        <div className={styles.mapMeta}><CircleDot size={13} /> PLAN KALİBRE EDİLDİ <span>30 PX/M</span></div>
        <div className={styles.zoomReadout}>{Math.round(viewport.scale * 100)}%</div>
        <div className={styles.mapTools}><button type="button" onClick={fitMap} title="Haritayı sığdır"><Maximize2 size={16} /></button><button type="button" title="Katmanlar"><Layers3 size={16} /></button><button type="button" title="Odak noktası"><Crosshair size={16} /></button></div>
        <motion.aside className={styles.sidebar} initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28 }}>
          <div className={styles.panelHeader}><span className={styles.iconFrame}><History size={18} /></span><div><small>HAREKET ANALİZİ</small><h2>Rota Geçmişi</h2></div></div>
          <p className={styles.intro}>Tag seçin, tarih aralığını belirleyin ve hareket akışını inceleyin.</p>
          <div className={styles.fields}>
            <label><span><MapPinned size={13} /> İZLENEN VARLIK</span><div className={styles.selectWrap}><select value={selectedTag} onChange={(event) => { const nextTag = event.target.value; setSelectedTag(nextTag); refreshHistory(nextTag, startDate, endDate); }}>{tagOptions.map((tag) => <option key={tag.id} value={tag.id}>{tag.name} · {tag.id}</option>)}</select><ChevronDown size={14} /></div></label>
            <div className={styles.dateGrid}><label><span><CalendarRange size={13} /> BAŞLANGIÇ</span><input type="datetime-local" value={startDate} onChange={(event) => { const value = event.target.value; setStartDate(value); refreshHistory(selectedTag, value, endDate); }} /></label><label><span><Clock3 size={13} /> BİTİŞ</span><input type="datetime-local" value={endDate} min={startDate} onChange={(event) => { const value = event.target.value; setEndDate(value); refreshHistory(selectedTag, startDate, value); }} /></label></div>
          </div>
          <button type="button" className={styles.searchButton} onClick={fetchHistory} disabled={loading}>{loading ? <Loader2 size={16} className={styles.spin} /> : <Search size={16} />}{loading ? "Geçmiş aranıyor" : "Geçmişi Getir"}</button>
          <motion.section className={styles.summary} key={positions[0]?.timestamp} initial={{ opacity: .4, y: 5 }} animate={{ opacity: 1, y: 0 }}><div className={styles.summaryTitle}><Route size={14} /><span>ROTA ÖZETİ</span><i>DEMO</i></div><div className={styles.stats}><div><small>BULUNAN NOKTA</small><strong>{positions.length}</strong><em>konum kaydı</em></div><div><small>TOPLAM MESAFE</small><strong>{distance.toFixed(1)}<b>m</b></strong><em>tahmini rota</em></div><div><small>ZİYARET EDİLEN BÖLGE</small><strong>{visitedLocationCount}</strong><em>benzersiz alan</em></div><div><small>TOPLAM TAKİP</small><strong>{formatDuration(totalDuration)}</strong><em>veri aralığı</em></div></div></motion.section>
          <section className={styles.timeline} aria-label="Konum zaman çizelgesi"><div className={styles.timelineHeader}><div className={styles.timelineTitle}><MapPin size={14} /><span>KONUM ZAMAN ÇİZELGESİ</span></div><span className={styles.timelineCount}>{visitedLocationCount} BÖLGE</span></div>{selectedStay && <button type="button" className={styles.showAll} onClick={() => { setSelectedStayId(null); fitMap(); }}>Tüm rotayı göster</button>}<div className={styles.timelineList}>{timeline.map((stay) => <button key={stay.id} type="button" className={`${styles.timelineRow} ${selectedStayId === stay.id ? styles.selectedTimelineRow : ""} ${stay.isDataGap ? styles.gapTimelineRow : ""}`} onClick={() => chooseStay(stay)}><span className={styles.timelineMarker} aria-hidden="true" /><span className={styles.timelineContent}><span className={styles.timelineTime}>{formatTime(stay.startedAt)} — {formatTime(stay.endedAt)} <b>· {formatDuration(stay.durationMs)}</b></span><strong>{stay.locationLabel}</strong>{!stay.isDataGap && longestStay?.id === stay.id && <em>EN UZUN KALIŞ</em>}</span></button>)}</div>{longestStay && <p className={styles.longestSummary}>En uzun kalış: <strong>{longestStay.locationLabel}</strong> · {formatDuration(longestStay.durationMs)}</p>}</section>
          <div className={styles.legend}><span><i className={styles.startDot} /> Başlangıç</span><span><i className={styles.routeDot} /> Rota</span><span><i className={styles.endDot} /> Bitiş</span></div>
        </motion.aside>
      </section>
    </main>
    <StatusStrip />
  </div>;
}
