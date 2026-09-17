"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from "react-konva";
import useImage from "use-image";
import {
  Check, CircleHelp, Crosshair, Download, DoorOpen, Hexagon, MousePointer2, Plus, Save,
  Power, Trash2, Upload, X,
} from "lucide-react";
import { MAP_FLOOR_PLAN, MAP_VIEWPORT_LIMITS } from "@/src/features/map/config/mapConfig";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import { TAG_LIVE_TIMEOUT_MS } from "@/src/features/tracking/types/tracking.types";
import { useElementSize } from "@/src/shared/hooks/useElementSize";
import { DEFAULT_REGIONS_CONFIG } from "../config/defaultRegionsConfig";
import { nextParameterHelpVisibility } from "../config/inferenceParameterHelp";
import { createAffineTransform, createInverseAffineTransform, withWorldCoordinates } from "../services/affineTransform";
import { hasExceededDragThreshold, type RegionPointerGesture } from "../services/regionGesture";
import { notifyRegionsConfigUpdated } from "../services/regionsConfig";
import type { CoordinatePair, RegionDefinition, RegionEditorTool, RegionsConfig } from "../types/region.types";
import { POSITION_ANIMATION_CONFIG_CHANGED_EVENT } from "@/src/features/tracking/config/positionAnimationConfig";
import {
  fetchRegionEngineStatus, REGION_ENGINE_STATUS_CHANGED_EVENT, updateRegionEngineStatus,
  type RegionEngineStatusResponse,
} from "../services/regionEngineApi";
import styles from "./regions.module.css";

import { RegionInferenceEditor } from "./RegionInferenceEditor";
import { ParameterHelpPanel } from "./ParameterHelpPanel";
import { RawTagLayer } from "./RawTagLayer";
import { createRawTagMarkers } from "../services/rawTagPresentation";
type SelectedPoint = { readonly type: "polygon" | "center" | "entrance"; readonly index: number } | null;
type Viewport = { readonly x: number; readonly y: number; readonly scale: number };

const INITIAL_VIEWPORT: Viewport = { x: 28, y: 24, scale: 0.7 };
const TOOL_LABELS: Record<RegionEditorTool, string> = {
  select: "Seç ve taşı", polygon: "Çokgen çiz", center: "Oda merkezi", entrance: "Giriş ekle",
};

function configWithSystemMap(config: RegionsConfig): RegionsConfig {
  return { ...config, map: DEFAULT_REGIONS_CONFIG.map };
}

function validateConfig(config: RegionsConfig): string[] {
  const errors: string[] = [];
  if (config.map.calibration.points.length < 3) errors.push("Sistem haritası için en az üç kalibrasyon noktası gerekli.");
  for (const region of config.regions) {
    if (!region.name.trim()) errors.push(`${region.id}: Oda adı boş olamaz.`);
    if (region.polygon.length < 3) errors.push(`${region.name || region.id}: Çokgen en az 3 noktadan oluşmalı.`);
    if (!region.roomCenter && region.kind !== "corridor" && !/^corridor/.test(region.id)) errors.push(`${region.name || region.id}: Oda merkezi eklenmeli.`);
  }
  return errors;
}

function downloadJson(config: RegionsConfig) {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "regions.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function RegionManagementPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pointerGestureRef = useRef<RegionPointerGesture | null>(null);
  const hasMobileInitialFitRef = useRef(false);
  const size = useElementSize(hostRef);
  const [floorImage] = useImage(MAP_FLOOR_PLAN.imageUrl, "anonymous");
  const [config, setConfig] = useState<RegionsConfig>(DEFAULT_REGIONS_CONFIG);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<SelectedPoint>(null);
  const [tool, setTool] = useState<RegionEditorTool>("select");
  const [viewport, setViewport] = useState<Viewport>(INITIAL_VIEWPORT);
  const [status, setStatus] = useState("Sistem haritası kullanılıyor");
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [engineStatus, setEngineStatus] = useState<RegionEngineStatusResponse | null>(null);
  const [engineUpdating, setEngineUpdating] = useState(false);
  const [showRawTagPositions, setShowRawTagPositions] = useState(false);
  const [propertyHelpOpen, setPropertyHelpOpen] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const savedConfigRef = useRef("");
  const [rawTagClock, setRawTagClock] = useState(() => Date.now());
  const observedTags = useIpsStore((state) => state.observedTags);

  const transform = useMemo(() => createAffineTransform(config.map.calibration.points), [config.map.calibration.points]);
  const inverseTransform = useMemo(() => createInverseAffineTransform(config.map.calibration.points), [config.map.calibration.points]);
  const rawTagMarkers = useMemo(
    () => createRawTagMarkers(observedTags, inverseTransform, rawTagClock, TAG_LIVE_TIMEOUT_MS),
    [inverseTransform, observedTags, rawTagClock],
  );
  const selectedRegion = config.regions.find((region) => region.id === selectedRegionId) ?? null;
  const selectedCoordinate = !selectedRegion || !selectedPoint ? null
    : selectedPoint.type === "center" ? selectedRegion.roomCenter
      : selectedPoint.type === "polygon" ? selectedRegion.polygon[selectedPoint.index] ?? null
        : selectedRegion.entrances[selectedPoint.index] ?? null;
  const selectedPointLabel = selectedPoint?.type === "center" ? "Oda merkezi"
    : selectedPoint?.type === "polygon" ? `Polygon köşesi ${selectedPoint.index + 1}`
      : selectedPoint?.type === "entrance" ? selectedRegion?.entrances[selectedPoint.index]?.label ?? `Giriş ${selectedPoint.index + 1}`
        : "Seçili nokta";
  const coordinateItems = selectedRegion ? [
    ...selectedRegion.polygon.map((point, index) => ({ type: "polygon" as const, index, label: `Köşe ${index + 1}`, point })),
    ...(selectedRegion.roomCenter ? [{ type: "center" as const, index: 0, label: "Oda merkezi", point: selectedRegion.roomCenter }] : []),
    ...selectedRegion.entrances.map((point, index) => ({ type: "entrance" as const, index, label: point.label, point })),
  ] : [];

  useEffect(() => {
    const stored = window.localStorage.getItem("ips-regions-config");
    const load = async () => {
      try {
        const response = await fetch("/api/regions");
        if (!response.ok) throw new Error("Config servisi yanıt vermedi");
        const payload = await response.json() as { config: RegionsConfig };
        const source = payload.config.regions.length > 0 || !stored ? payload.config : JSON.parse(stored) as RegionsConfig;
        const normalized = configWithSystemMap(source);
        savedConfigRef.current = JSON.stringify(normalized);
        setConfig(normalized);
        setSelectedRegionId(normalized.regions[0]?.id ?? null);
        setStatus("Kaydedilmiş oda/bölge ayarları yüklendi");
      } catch {
        if (!stored) return;
        try {
          const normalized = configWithSystemMap(JSON.parse(stored) as RegionsConfig);
          savedConfigRef.current = JSON.stringify(normalized);
          setConfig(normalized);
          setSelectedRegionId(normalized.regions[0]?.id ?? null);
          setStatus("Yerel oda/bölge ayarları yüklendi");
        } catch {
          setStatus("Config okunamadı; varsayılan config kullanılıyor");
        }
      }
    };
    void load();
  }, []);

  useEffect(() => {
    if (!savedConfigRef.current) return;
    setHasUnsavedChanges(JSON.stringify(configWithSystemMap(config)) !== savedConfigRef.current);
  }, [config]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (!hasUnsavedChanges) return; event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    void fetchRegionEngineStatus().then(setEngineStatus).catch((error) => {
      setStatus(error instanceof Error ? error.message : "Oda tespit modu durumu alınamadı");
    });
  }, []);

  useEffect(() => {
    if (!showRawTagPositions) return;
    const timer = window.setInterval(() => setRawTagClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [showRawTagPositions]);

  const toggleRegionEngine = async () => {
    if (!engineStatus || engineUpdating) return;
    setEngineUpdating(true);
    setErrors([]);
    try {
      const next = await updateRegionEngineStatus(!engineStatus.enabled);
      setEngineStatus(next);
      setStatus(next.enabled
        ? `Oda Tespit Motoru aktif · canlı konum akışı :${next.processedPort}`
        : `Oda Tespit Motoru kapalı · ham akış :${next.rawPort}`);
      window.dispatchEvent(new CustomEvent(REGION_ENGINE_STATUS_CHANGED_EVENT, { detail: next }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Oda tespit modu değiştirilemedi";
      setErrors([message]);
      setStatus(message);
    } finally {
      setEngineUpdating(false);
    }
  };

  const updateRegion = useCallback((id: string, updater: (region: RegionDefinition) => RegionDefinition) => {
    setConfig((current) => ({ ...current, regions: current.regions.map((region) => region.id === id ? updater(region) : region) }));
    setErrors([]);
  }, []);

  const fitToScreen = useCallback(() => {
    if (size.width <= 0 || size.height <= 0) return;
    const padding = 38;
    const scale = Math.max(0.1, Math.min(
      (size.width - padding * 2) / MAP_FLOOR_PLAN.canvasSize.width,
      (size.height - padding * 2) / MAP_FLOOR_PLAN.canvasSize.height,
    ));
    setViewport({
      scale,
      x: (size.width - MAP_FLOOR_PLAN.canvasSize.width * scale) / 2,
      y: (size.height - MAP_FLOOR_PLAN.canvasSize.height * scale) / 2,
    });
  }, [size.height, size.width]);

  useEffect(() => {
    if (hasMobileInitialFitRef.current || size.width <= 0 || size.height <= 0 || !window.matchMedia("(max-width: 680px)").matches) return;
    hasMobileInitialFitRef.current = true;
    fitToScreen();
  }, [fitToScreen, size.height, size.width]);

  const pointerToPixel = useCallback(() => {
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return null;
    const pixel = { x: (pointer.x - viewport.x) / viewport.scale, y: (pointer.y - viewport.y) / viewport.scale };
    if (pixel.x < 0 || pixel.y < 0 || pixel.x > MAP_FLOOR_PLAN.canvasSize.width || pixel.y > MAP_FLOOR_PLAN.canvasSize.height) return null;
    return withWorldCoordinates(pixel, transform);
  }, [transform, viewport]);

  const addRegion = () => {
    const number = config.regions.length + 1;
    const region: RegionDefinition = {
      id: `zone-${crypto.randomUUID().slice(0, 8)}`,
      name: `Yeni Oda/Bölge ${number}`,
      color: "#00a896",
      polygon: [],
      roomCenter: null,
      entrances: [],
    };
    setConfig((current) => ({ ...current, regions: [...current.regions, region] }));
    setSelectedRegionId(region.id);
    setSelectedPoint(null);
    setTool("polygon");
    setStatus("Çokgen köşelerini harita üzerinde işaretleyin");
  };

  const addPointAtPointer = () => {
    if (tool === "select" || !selectedRegion) return;
    const point = pointerToPixel();
    if (!point) return;
    if (tool === "polygon") {
      updateRegion(selectedRegion.id, (region) => ({ ...region, polygon: [...region.polygon, point] }));
    } else if (tool === "center") {
      updateRegion(selectedRegion.id, (region) => ({ ...region, roomCenter: point }));
      setTool("select");
      setStatus("Oda merkezi eklendi");
    } else if (tool === "entrance") {
      updateRegion(selectedRegion.id, (region) => ({
        ...region,
        entrances: [...region.entrances, { ...point, id: `entrance-${crypto.randomUUID().slice(0, 8)}`, label: `Giriş ${region.entrances.length + 1}` }],
      }));
      setStatus("Giriş eklendi; başka bir giriş ekleyebilirsiniz");
    }
  };

  const handlePointerDown = (event: Konva.KonvaEventObject<PointerEvent>) => {
    if (event.target !== event.target.getStage()) {
      pointerGestureRef.current = null;
      return;
    }
    const pointer = stageRef.current?.getPointerPosition();
    pointerGestureRef.current = pointer ? { start: pointer, moved: false } : null;
  };

  const handlePointerMove = () => {
    const gesture = pointerGestureRef.current;
    const pointer = stageRef.current?.getPointerPosition();
    if (!gesture || !pointer || gesture.moved || !hasExceededDragThreshold(gesture.start, pointer)) return;
    pointerGestureRef.current = { ...gesture, moved: true };
  };

  const handlePointerUp = (event: Konva.KonvaEventObject<PointerEvent>) => {
    const gesture = pointerGestureRef.current;
    pointerGestureRef.current = null;
    if (!gesture || gesture.moved || event.target !== event.target.getStage()) return;
    addPointAtPointer();
  };

  const updateCoordinate = (type: NonNullable<SelectedPoint>["type"], index: number, point: CoordinatePair) => {
    if (!selectedRegion) return;
    updateRegion(selectedRegion.id, (region) => {
      if (type === "center") return { ...region, roomCenter: point };
      if (type === "polygon") return { ...region, polygon: region.polygon.map((value, itemIndex) => itemIndex === index ? point : value) };
      return { ...region, entrances: region.entrances.map((value, itemIndex) => itemIndex === index ? { ...value, ...point } : value) };
    });
  };

  const updatePoint = (type: NonNullable<SelectedPoint>["type"], index: number, pixel: { x: number; y: number }) => {
    updateCoordinate(type, index, withWorldCoordinates(pixel, transform));
  };

  const updateSelectedPixel = (axis: "x" | "y", value: number) => {
    if (!selectedPoint || !selectedCoordinate || !Number.isFinite(value)) return;
    updatePoint(selectedPoint.type, selectedPoint.index, { ...selectedCoordinate.pixel, [axis]: value });
  };

  const updateSelectedWorld = (axis: "x" | "y", value: number) => {
    if (!selectedPoint || !selectedCoordinate || !Number.isFinite(value)) return;
    const world = { ...selectedCoordinate.world, [axis]: value };
    const pixel = inverseTransform(world);
    updateCoordinate(selectedPoint.type, selectedPoint.index, {
      pixel: { x: Math.round(pixel.x * 100) / 100, y: Math.round(pixel.y * 100) / 100 },
      world: { x: Math.round(world.x * 1000) / 1000, y: Math.round(world.y * 1000) / 1000 },
    });
  };

  const deleteSelectedPoint = () => {
    if (!selectedRegion || !selectedPoint) return;
    updateRegion(selectedRegion.id, (region) => {
      if (selectedPoint.type === "center") return { ...region, roomCenter: null };
      if (selectedPoint.type === "polygon") return { ...region, polygon: region.polygon.filter((_, index) => index !== selectedPoint.index) };
      return { ...region, entrances: region.entrances.filter((_, index) => index !== selectedPoint.index) };
    });
    setSelectedPoint(null);
  };

  const deleteRegion = () => {
    if (!selectedRegion) return;
    const remaining = config.regions.filter((region) => region.id !== selectedRegion.id);
    setConfig((current) => ({ ...current, regions: remaining }));
    setSelectedRegionId(remaining[0]?.id ?? null);
    setSelectedPoint(null);
    setStatus("Oda/bölge silindi");
  };

  const saveConfig = async () => {
    const validationErrors = validateConfig(config);
    setErrors(validationErrors);
    if (validationErrors.length) {
      setStatus("Kaydetmeden önce eksikleri düzeltin");
      return;
    }
    const normalized = configWithSystemMap(config);
    if (!window.confirm("Ayarların uygulanması aktif oda kararlarını yeniden doğrulama durumuna geçirir. Yeni ölçümler geldikçe odalar tekrar doğrulanacaktır. Devam edilsin mi?")) return;
    try {
      const validationResponse = await fetch("/api/regions/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(normalized) });
      const validation = await validationResponse.json() as { valid?: boolean; error?: string; warnings?: readonly string[] };
      if (!validationResponse.ok || !validation.valid) throw new Error(validation.error || "Config backend doğrulamasından geçemedi");
      const response = await fetch("/api/regions", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(normalized) });
      const payload = await response.json() as { error?: string; config?: RegionsConfig; configVersion?: string };
      if (!response.ok) throw new Error(payload.error || "Config dosyasına yazılamadı");
      const saved = payload.config ?? normalized;
      window.localStorage.setItem("ips-regions-config", JSON.stringify(saved));
      savedConfigRef.current = JSON.stringify(saved);
      setConfig(saved); setHasUnsavedChanges(false);
      window.dispatchEvent(new CustomEvent(
        POSITION_ANIMATION_CONFIG_CHANGED_EVENT,
        { detail: saved.positionAnimation },
      ));
      notifyRegionsConfigUpdated(saved);
      void fetchRegionEngineStatus().then(setEngineStatus);
      setStatus(`Oda/bölge ayarları kaydedildi${payload.configVersion ? ` · ${payload.configVersion}` : ""}`);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Config dosyasına yazılamadı"]);
      setStatus("Config kaydedilmedi; mevcut çalışan ayarlar korundu");
    }
  };

  const importConfig = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as RegionsConfig;
      if (!Array.isArray(parsed.regions)) throw new Error("regions alanı bulunamadı");
      const normalized = configWithSystemMap(parsed);
      setConfig(normalized);
      setSelectedRegionId(normalized.regions[0]?.id ?? null);
      setErrors([]);
      setStatus("Config yüklendi; harita kaynağı sistem haritası olarak korundu");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Config okunamadı"]);
      setStatus("Config yüklenemedi");
    }
  };

  const handleWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    const direction = event.evt.deltaY > 0 ? -1 : 1;
    const minimumScale = Math.min(MAP_VIEWPORT_LIMITS.minZoom, Math.max(0.1, Math.min(
      (size.width - 76) / MAP_FLOOR_PLAN.canvasSize.width,
      (size.height - 76) / MAP_FLOOR_PLAN.canvasSize.height,
    )));
    const scale = Math.min(MAP_VIEWPORT_LIMITS.maxZoom, Math.max(minimumScale, viewport.scale * Math.pow(1.08, direction)));
    const mapPoint = { x: (pointer.x - viewport.x) / viewport.scale, y: (pointer.y - viewport.y) / viewport.scale };
    setViewport({ scale, x: pointer.x - mapPoint.x * scale, y: pointer.y - mapPoint.y * scale });
  };

  const pointCircle = (point: CoordinatePair, type: NonNullable<SelectedPoint>["type"], index: number, color: string) => (
    <Circle
      key={`${type}-${index}`}
      x={point.pixel.x}
      y={point.pixel.y}
      radius={type === "polygon" ? 6 : 8}
      fill="#ffffff"
      stroke={color}
      strokeWidth={selectedPoint?.type === type && selectedPoint.index === index ? 4 : 2.5}
      draggable={tool === "select"}
      onClick={(event) => { event.cancelBubble = true; setSelectedPoint({ type, index }); }}
      onTap={(event) => { event.cancelBubble = true; setSelectedPoint({ type, index }); }}
      onDragEnd={(event) => updatePoint(type, index, { x: event.target.x(), y: event.target.y() })}
    />
  );

  return (
    <section className={styles.panel}>
      {engineStatus?.warnings?.length ? (
        <details className={styles.warningDetails}>
          <summary>Harita çıkarım sınırlamaları ({engineStatus.warnings.length})</summary>
          <div>{engineStatus.warnings.map(w => <p key={w}>{w}</p>)}</div>
        </details>
      ) : null}
      <header className={styles.header}>
        <div><span>ODA/BÖLGE YÖNETİMİ / {MAP_FLOOR_PLAN.level.toUpperCase()}</span><h1>Oda/Bölge Paneli</h1></div>
        <div className={styles.systemMap}><Check size={14} /><span>SİSTEM HARİTASI</span><strong>{MAP_FLOOR_PLAN.name}</strong></div>
        <button
          type="button"
          role="switch"
          aria-checked={engineStatus?.enabled ?? false}
          className={`${styles.engineToggle} ${engineStatus?.enabled ? styles.engineToggleEnabled : ""}`}
          disabled={!engineStatus || engineUpdating}
          onClick={() => void toggleRegionEngine()}
        >
          <Power size={14} />
          <span>ODA TESPİT MOTORU</span>
          <strong>{engineUpdating ? "GÜNCELLENİYOR" : engineStatus?.enabled ? `AKTİF · :${engineStatus.processedPort}` : "KAPALI"}</strong>
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={showRawTagPositions}
          aria-label={`Ham tag konumları görünümünü ${showRawTagPositions ? "kapat" : "aç"}`}
          className={`${styles.rawTagToggle} ${showRawTagPositions ? styles.rawTagToggleEnabled : ""}`}
          onClick={() => {
            if (!showRawTagPositions) setRawTagClock(Date.now());
            setShowRawTagPositions((current) => !current);
          }}
        >
          <Crosshair size={14} />
          <span>HAM TAG KONUMLARI</span>
          <strong>{showRawTagPositions ? "AKTİF" : "KAPALI"}</strong>
        </button>
        <div className={styles.headerActions}>
          <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importConfig(file); event.currentTarget.value = ""; }} />
          <button onClick={() => fileInputRef.current?.click()}><Upload size={14} /> Config yükle</button>
          <button onClick={() => downloadJson(configWithSystemMap(config))}><Download size={14} /> Dışa aktar</button>
          <button className={styles.primary} onClick={saveConfig}><Save size={14} /> {hasUnsavedChanges ? "Kaydet *" : "Kaydet"}</button>
        </div>
      </header>

      <div className={styles.editor}>
        <aside className={styles.zonePanel}>
          <div className={styles.displayWaitConfig}>
            <label htmlFor="outside-hold-ms">Alan dışı gösterim bekleme süresi (ms)</label>
            <input id="outside-hold-ms" type="number" min={0} max={3600000} step={100}
              value={config.mapDisplay?.outsideHoldMs ?? 2000}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value >= 0 && value <= 3600000) {
                  setConfig((current) => ({ ...current, mapDisplay: { outsideHoldMs: value } }));
                }
              }} />
            <p>Tag bu süre boyunca son geçerli konumda tutulur, ardından haritada gizlenir.</p>
          </div>
          <div className={styles.panelTitle}><div><span>ODA/BÖLGE LİSTESİ</span><strong>{config.regions.length} oda/bölge</strong></div><button onClick={addRegion} title="Yeni oda/bölge"><Plus size={15} /></button></div>
          <div className={styles.zoneList}>
            {config.regions.length === 0 && <div className={styles.empty}><Hexagon size={24} /><strong>Henüz oda/bölge yok</strong><span>Yeni oda/bölge ekleyerek başlayın.</span></div>}
            {config.regions.map((region) => <button key={region.id} className={region.id === selectedRegionId ? styles.selectedZone : ""} onClick={() => { setSelectedRegionId(region.id); setSelectedPoint(null); setTool("select"); }}><i style={{ background: region.color }} /><div><strong>{region.name}</strong><span>{region.polygon.length} köşe · {region.entrances.length} giriş</span></div></button>)}
          </div>
          <div className={styles.mapInfo}><span>HARİTA KAYNAĞI</span><strong>{MAP_FLOOR_PLAN.id}</strong><small>{MAP_FLOOR_PLAN.canvasSize.width} × {MAP_FLOOR_PLAN.canvasSize.height} px</small><p>Harita sistem ayarlarından alınır ve bu ekrandan değiştirilemez.</p></div>
        </aside>

        <div ref={hostRef} className={styles.map}>
          <Stage
            ref={stageRef}
            width={size.width}
            height={size.height}
            draggable
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => { pointerGestureRef.current = null; }}
            onDragEnd={(event) => {
              if (event.target !== event.target.getStage()) return;
              setViewport((current) => ({ ...current, x: current.x + event.target.x(), y: current.y + event.target.y() }));
              event.target.position({ x: 0, y: 0 });
            }}
          >
            <Layer listening={false}><Group x={viewport.x} y={viewport.y} scaleX={viewport.scale} scaleY={viewport.scale}><Rect width={MAP_FLOOR_PLAN.canvasSize.width} height={MAP_FLOOR_PLAN.canvasSize.height} fill="#eef5f7" />{floorImage && <KonvaImage image={floorImage} width={MAP_FLOOR_PLAN.canvasSize.width} height={MAP_FLOOR_PLAN.canvasSize.height} opacity={0.92} />}</Group></Layer>
            <Layer><Group x={viewport.x} y={viewport.y} scaleX={viewport.scale} scaleY={viewport.scale}>
              {config.regions.map((region) => {
                const selected = region.id === selectedRegionId;
                const points = region.polygon.flatMap((point) => [point.pixel.x, point.pixel.y]);
                return <Group key={region.id} opacity={selected ? 1 : 0.55}>
                  {points.length >= 4 && <Line points={points} closed={region.polygon.length >= 3} fill={`${region.color}26`} stroke={region.color} strokeWidth={selected ? 3 : 2} />}
                  {selected && region.polygon.map((point, index) => pointCircle(point, "polygon", index, region.color))}
                  {region.roomCenter && <><Circle x={region.roomCenter.pixel.x} y={region.roomCenter.pixel.y} radius={13} fill={region.color} opacity={0.2} listening={false} />{selected ? pointCircle(region.roomCenter, "center", 0, region.color) : <Circle x={region.roomCenter.pixel.x} y={region.roomCenter.pixel.y} radius={5} fill={region.color} />}</>}
                  {region.entrances.map((entrance, index) => <Group key={entrance.id}>{selected ? pointCircle(entrance, "entrance", index, "#f29f05") : <Circle x={entrance.pixel.x} y={entrance.pixel.y} radius={6} fill="#f29f05" />}<Text x={entrance.pixel.x + 10} y={entrance.pixel.y - 5} text={entrance.label} fill="#7a5410" fontSize={10} /></Group>)}
                  {region.polygon.length > 0 && <Text x={region.polygon[0].pixel.x + 10} y={region.polygon[0].pixel.y + 9} text={region.name} fill={region.color} fontSize={12} fontStyle="bold" />}
                </Group>;
              })}
            </Group></Layer>
            {showRawTagPositions && <RawTagLayer markers={rawTagMarkers} viewport={viewport} />}
          </Stage>
          <div className={styles.tools}>
            {(["select", "polygon", "center", "entrance"] as const).map((value) => {
              const Icon = value === "select" ? MousePointer2 : value === "polygon" ? Hexagon : value === "center" ? Crosshair : DoorOpen;
              return <button key={value} className={tool === value ? styles.activeTool : ""} disabled={!selectedRegion && value !== "select"} onClick={() => { setTool(value); setSelectedPoint(null); }} title={TOOL_LABELS[value]}><Icon size={16} /><span>{TOOL_LABELS[value]}</span></button>;
            })}
            {tool === "polygon" && <button className={styles.finishTool} disabled={(selectedRegion?.polygon.length ?? 0) < 3} onClick={() => { setTool("select"); setStatus("Çokgen tamamlandı"); }}><Check size={16} /><span>Tamamla</span></button>}
          </div>
          <div className={styles.mapControls}><button onClick={fitToScreen}>SIĞDIR</button><span>{Math.round(viewport.scale * 100)}%</span></div>
          {showRawTagPositions && (
            <div className={styles.rawTagStatus}>
              {rawTagMarkers.length > 0 ? `Ham konum görünümü aktif · ${rawTagMarkers.length} tag` : "Ham tag verisi bekleniyor…"}
            </div>
          )}
          <div className={styles.mapStatus}>{status}</div>
        </div>

        <aside className={styles.properties}>
          <div className={styles.panelTitle}>
            <div><span>ÖZELLİKLER</span><strong>{selectedRegion ? "Seçili oda/bölge" : "Oda/bölge seçilmedi"}</strong></div>
            <button
              type="button"
              className={`${styles.propertyHelpButton} ${propertyHelpOpen ? styles.propertyHelpButtonActive : ""}`}
              onClick={() => setPropertyHelpOpen(current => nextParameterHelpVisibility(current, "toggle"))}
              title="Özellik ve hesaplama rehberi"
              aria-label="Özellik ve hesaplama rehberini aç"
              aria-expanded={propertyHelpOpen}
              aria-controls="region-property-help"
            >
              <CircleHelp size={16} />
            </button>
          </div>
          <ParameterHelpPanel
            id="region-property-help"
            open={propertyHelpOpen}
            onClose={() => setPropertyHelpOpen(current => nextParameterHelpVisibility(current, "close"))}
          />
          {!selectedRegion ? <div className={styles.empty}><MousePointer2 size={24} /><strong>Bir oda/bölge seçin</strong><span>Özellikleri burada düzenleyebilirsiniz.</span></div> : <>
            <section className={styles.pointListSection}>
              <div className={styles.pointListTitle}><span>NOKTA KOORDİNATLARI</span><strong>{coordinateItems.length} nokta</strong></div>
              {coordinateItems.length === 0 ? <div className={styles.pointPrompt}><Crosshair size={18} /><span>Polygon, merkez veya giriş eklediğinizde koordinatlar burada görünecek.</span></div> : <div className={styles.pointList}>
                {coordinateItems.map((item) => {
                  const active = selectedPoint?.type === item.type && selectedPoint.index === item.index;
                  return <button key={`${item.type}-${item.index}`} className={active ? styles.activePoint : ""} onClick={() => { setSelectedPoint({ type: item.type, index: item.index }); setTool("select"); }}>
                    <i style={{ background: item.type === "entrance" ? "#f29f05" : selectedRegion.color }} />
                    <div><strong>{item.label}</strong><span>px {item.point.pixel.x.toFixed(2)}, {item.point.pixel.y.toFixed(2)}</span><small>m {item.point.world.x.toFixed(3)}, {item.point.world.y.toFixed(3)}</small></div>
                  </button>;
                })}
              </div>}
            </section>
            {selectedPoint && selectedCoordinate ? <section className={styles.pointEditor}>
              <div className={styles.pointEditorTitle}><div><span>İNCE AYAR</span><strong>{selectedPointLabel}</strong></div><i style={{ background: selectedPoint.type === "entrance" ? "#f29f05" : selectedRegion.color }} /></div>
              <div className={styles.coordinateGrid}>
                <label><span>Pixel X</span><input type="number" step="0.01" value={selectedCoordinate.pixel.x} onChange={(event) => updateSelectedPixel("x", event.currentTarget.valueAsNumber)} /></label>
                <label><span>Pixel Y</span><input type="number" step="0.01" value={selectedCoordinate.pixel.y} onChange={(event) => updateSelectedPixel("y", event.currentTarget.valueAsNumber)} /></label>
                <label><span>Gerçek X (m)</span><input type="number" step="0.001" value={selectedCoordinate.world.x} onChange={(event) => updateSelectedWorld("x", event.currentTarget.valueAsNumber)} /></label>
                <label><span>Gerçek Y (m)</span><input type="number" step="0.001" value={selectedCoordinate.world.y} onChange={(event) => updateSelectedWorld("y", event.currentTarget.valueAsNumber)} /></label>
              </div>
              <small>Bir değer değiştiğinde karşılığı sistem kalibrasyonuna göre otomatik hesaplanır.</small>
            </section> : coordinateItems.length > 0 && <div className={styles.selectHint}><MousePointer2 size={14} /> İnce ayar için listeden veya haritadan bir nokta seçin.</div>}
            <label><span>Oda/bölge adı</span><input value={selectedRegion.name} onChange={(event) => updateRegion(selectedRegion.id, (region) => ({ ...region, name: event.target.value }))} /></label>
            <div className={styles.fieldRow}><label><span>Kimlik</span><input value={selectedRegion.id} readOnly /></label><label className={styles.colorField}><span>Renk</span><input type="color" value={selectedRegion.color} onChange={(event) => updateRegion(selectedRegion.id, (region) => ({ ...region, color: event.target.value }))} /></label></div>
            <RegionInferenceEditor region={selectedRegion} config={config} onConfigChange={setConfig} engineStatus={engineStatus} />
            <div className={styles.metrics}><div><span>ÇOKGEN</span><strong>{selectedRegion.polygon.length}</strong><small>köşe</small></div><div><span>GİRİŞLER</span><strong>{selectedRegion.entrances.length}</strong><small>nokta</small></div></div>
            <section className={styles.coordinateSection}><h2>Gerçek dünya koordinatları</h2>{selectedRegion.roomCenter ? <p>Merkez: <code>{selectedRegion.roomCenter.world.x.toFixed(2)}, {selectedRegion.roomCenter.world.y.toFixed(2)} m</code></p> : <p>Oda merkezi tanımlanmadı.</p>}<small>Haritadaki bir noktayı seçerek koordinatlarını ince ayarlayabilirsiniz.</small></section>
            {selectedPoint && <button className={styles.deletePoint} onClick={deleteSelectedPoint}><X size={14} /> Seçili noktayı sil</button>}
            {errors.length > 0 && <div className={styles.errors}>{errors.map((error) => <p key={error}>{error}</p>)}</div>}
            <button className={styles.deleteZone} onClick={deleteRegion}><Trash2 size={14} /> Oda/bölgeyi sil</button>
          </>}
        </aside>
      </div>
    </section>
  );
}
