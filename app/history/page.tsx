"use client";

import { motion } from "framer-motion";
import { CalendarRange, ChevronDown, CircleDot, Clock3, Crosshair, History, Layers3, Loader2, MapPinned, Maximize2, Route, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import useImage from "use-image";
import { AppHeader } from "@/src/app/components/AppHeader";
import { AppSidebar, type WorkspaceView } from "@/src/app/components/AppSidebar";
import { StatusStrip } from "@/src/app/components/StatusStrip";
import { DEMO_FLOOR_PLAN } from "@/src/features/map/config/demoMap";
import { useElementSize } from "@/src/shared/hooks/useElementSize";
import styles from "./history.module.css";

type RoutePoint = readonly [number, number];

const BASE_ROUTE: readonly RoutePoint[] = [[182, 544], [226, 518], [269, 496], [318, 508], [357, 475], [408, 447], [452, 430], [493, 447], [537, 426], [585, 394], [632, 407], [678, 376], [720, 348], [762, 360], [809, 329], [858, 302], [905, 318], [956, 286], [1006, 254], [1064, 238]];
const TAG_OPTIONS = [{ id: "TAG-001", name: "Forklift 07" }, { id: "TAG-014", name: "Personel A14" }, { id: "TAG-028", name: "Palet 28" }];

function routeDistance(points: readonly RoutePoint[]): number { return points.slice(1).reduce((total, point, index) => total + Math.hypot(point[0] - points[index][0], point[1] - points[index][1]), 0) / 30; }
function buildRoute(seed: number): RoutePoint[] { return BASE_ROUTE.map(([x, y], index) => [x + Math.sin(seed + index * .73) * 11, y + Math.cos(seed * .6 + index * .45) * 8]); }

export default function HistoryPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const size = useElementSize(hostRef);
  const [floorImage] = useImage(DEMO_FLOOR_PLAN.imageUrl, "anonymous");
  const [selectedTag, setSelectedTag] = useState(TAG_OPTIONS[0].id);
  const [requestedTag, setRequestedTag] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("2026-07-15T08:00");
  const [endDate, setEndDate] = useState("2026-07-15T12:00");
  const [route, setRoute] = useState<RoutePoint[]>(() => buildRoute(.4));
  const [loading, setLoading] = useState(false);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: .9 });

  const fitMap = useCallback(() => {
    const padding = 62;
    const scale = Math.min((size.width - padding * 2) / DEMO_FLOOR_PLAN.canvasSize.width, (size.height - padding * 2) / DEMO_FLOOR_PLAN.canvasSize.height);
    setViewport({ scale, x: (size.width - DEMO_FLOOR_PLAN.canvasSize.width * scale) / 2, y: (size.height - DEMO_FLOOR_PLAN.canvasSize.height * scale) / 2 });
  }, [size.height, size.width]);

  useEffect(() => { if (size.width > 1 && size.height > 1) fitMap(); }, [fitMap, size.height, size.width]);
  useEffect(() => {
    const tagId = new URLSearchParams(window.location.search).get("tag")?.trim().toUpperCase();
    if (tagId) { setRequestedTag(tagId); setSelectedTag(tagId); }
  }, []);

  const tagOptions = requestedTag && !TAG_OPTIONS.some((tag) => tag.id === requestedTag) ? [...TAG_OPTIONS, { id: requestedTag, name: "Seçili Tag" }] : TAG_OPTIONS;
  const activeTag = tagOptions.find((tag) => tag.id === selectedTag) ?? tagOptions[0];
  const pointValues = useMemo(() => route.flatMap(([x, y]) => [x, y]), [route]);
  const distance = useMemo(() => routeDistance(route), [route]);
  const startPoint = route[0];
  const endPoint = route.at(-1);

  const fetchHistory = () => {
    if (loading) return;
    setLoading(true);
    window.setTimeout(() => { setRoute(buildRoute(Date.now() / 1300)); setLoading(false); }, 700);
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
            <Layer listening={false}><Group scaleX={viewport.scale} scaleY={viewport.scale}><Line points={pointValues} stroke="#00a896" strokeWidth={12} opacity={.15} tension={.32} lineCap="round" lineJoin="round" /><Line points={pointValues} stroke="#3578e5" strokeWidth={3.5} opacity={.95} tension={.32} lineCap="round" lineJoin="round" shadowColor="#00a896" shadowBlur={12} shadowOpacity={.48} />{route.map(([x, y], index) => <Circle key={`${x}-${y}`} x={x} y={y} radius={index % 3 === 0 ? 3.5 : 2.2} fill="#ffffff" stroke="#00a896" strokeWidth={1.3} opacity={.95} />)}{startPoint && <Group x={startPoint[0]} y={startPoint[1]}><Circle radius={14} fill="#21d497" opacity={.19} /><Circle radius={7} fill="#13a875" stroke="#ffffff" strokeWidth={2} /><Text x={15} y={-5} text="BAŞLANGIÇ" fill="#087f73" fontSize={10} fontStyle="bold" fontFamily="Inter, sans-serif" /></Group>}{endPoint && <Group x={endPoint[0]} y={endPoint[1]}><Circle radius={16} fill="#f35166" opacity={.19} /><Circle radius={8} fill="#e65353" stroke="#ffffff" strokeWidth={2} /><Text x={16} y={-5} text="BİTİŞ" fill="#bd3e4b" fontSize={10} fontStyle="bold" fontFamily="Inter, sans-serif" /></Group>}</Group></Layer>
          </Stage>
        </div>
        <div className={styles.vignette} />
        <div className={styles.mapMeta}><CircleDot size={13} /> PLAN KALİBRE EDİLDİ <span>30 PX/M</span></div>
        <div className={styles.zoomReadout}>{Math.round(viewport.scale * 100)}%</div>
        <div className={styles.mapTools}><button type="button" onClick={fitMap} title="Haritayı sığdır"><Maximize2 size={16} /></button><button type="button" title="Katmanlar"><Layers3 size={16} /></button><button type="button" title="Odak noktası"><Crosshair size={16} /></button></div>
        <motion.aside className={styles.sidebar} initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", stiffness: 300, damping: 28 }}>
          <div className={styles.panelHeader}><span className={styles.iconFrame}><History size={18} /></span><div><small>HAREKET ANALİZİ</small><h2>Rota Geçmişi</h2></div></div>
          <p className={styles.intro}>Tag seçin, tarih aralığını belirleyin ve hareket akışını inceleyin.</p>
          <div className={styles.fields}><label><span><MapPinned size={13} /> İZLENEN VARLIK</span><div className={styles.selectWrap}><select value={selectedTag} onChange={(event) => setSelectedTag(event.target.value)}>{tagOptions.map((tag) => <option key={tag.id} value={tag.id}>{tag.name} · {tag.id}</option>)}</select><ChevronDown size={14} /></div></label><div className={styles.dateGrid}><label><span><CalendarRange size={13} /> BAŞLANGIÇ</span><input type="datetime-local" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label><span><Clock3 size={13} /> BİTİŞ</span><input type="datetime-local" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></label></div></div>
          <button type="button" className={styles.searchButton} onClick={fetchHistory} disabled={loading}>{loading ? <Loader2 size={16} className={styles.spin} /> : <Search size={16} />}{loading ? "Geçmiş aranıyor" : "Geçmişi Getir"}</button>
          <motion.section className={styles.summary} key={route[0]?.join("-")} initial={{ opacity: .4, y: 5 }} animate={{ opacity: 1, y: 0 }}><div className={styles.summaryTitle}><Route size={14} /><span>ROTA ÖZETİ</span><i>DEMO</i></div><div className={styles.stats}><div><small>BULUNAN NOKTA</small><strong>{route.length}</strong><em>konum kaydı</em></div><div><small>TOPLAM MESAFE</small><strong>{distance.toFixed(1)}<b>m</b></strong><em>tahmini rota</em></div></div></motion.section>
          <div className={styles.legend}><span><i className={styles.startDot} /> Başlangıç</span><span><i className={styles.routeDot} /> Rota</span><span><i className={styles.endDot} /> Bitiş</span></div>
        </motion.aside>
      </section>
    </main>
    <StatusStrip />
  </div>;
}
