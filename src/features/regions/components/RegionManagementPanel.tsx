"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from "react-konva";
import useImage from "use-image";
import {
  Check, Crosshair, Download, DoorOpen, Hexagon, MousePointer2, Plus, Save,
  Trash2, Upload, X,
} from "lucide-react";
import { MAP_FLOOR_PLAN, MAP_VIEWPORT_LIMITS } from "@/src/features/map/config/mapConfig";
import { useElementSize } from "@/src/shared/hooks/useElementSize";
import { DEFAULT_REGIONS_CONFIG } from "../config/defaultRegionsConfig";
import { createAffineTransform, withWorldCoordinates } from "../services/affineTransform";
import type { CoordinatePair, RegionDefinition, RegionEditorTool, RegionsConfig } from "../types/region.types";
import styles from "./regions.module.css";

type SelectedPoint = { readonly type: "polygon" | "center" | "entrance"; readonly index: number } | null;
type Viewport = { readonly x: number; readonly y: number; readonly scale: number };

const INITIAL_VIEWPORT: Viewport = { x: 28, y: 24, scale: 0.7 };
const TOOL_LABELS: Record<RegionEditorTool, string> = {
  select: "Seç ve taşı", polygon: "Polygon çiz", center: "Oda merkezi", entrance: "Giriş ekle",
};

function configWithSystemMap(config: RegionsConfig): RegionsConfig {
  return { ...config, map: DEFAULT_REGIONS_CONFIG.map };
}

function validateConfig(config: RegionsConfig): string[] {
  const errors: string[] = [];
  if (config.map.calibration.points.length < 3) errors.push("Sistem haritası için en az üç kalibrasyon noktası gerekli.");
  for (const region of config.regions) {
    if (!region.name.trim()) errors.push(`${region.id}: Oda adı boş olamaz.`);
    if (region.polygon.length < 3) errors.push(`${region.name || region.id}: Polygon en az 3 noktadan oluşmalı.`);
    if (!region.roomCenter) errors.push(`${region.name || region.id}: Oda merkezi eklenmeli.`);
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
  const size = useElementSize(hostRef);
  const [floorImage] = useImage(MAP_FLOOR_PLAN.imageUrl, "anonymous");
  const [config, setConfig] = useState<RegionsConfig>(DEFAULT_REGIONS_CONFIG);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<SelectedPoint>(null);
  const [tool, setTool] = useState<RegionEditorTool>("select");
  const [viewport, setViewport] = useState<Viewport>(INITIAL_VIEWPORT);
  const [status, setStatus] = useState("Sistem haritası kullanılıyor");
  const [errors, setErrors] = useState<readonly string[]>([]);

  const transform = useMemo(() => createAffineTransform(config.map.calibration.points), [config.map.calibration.points]);
  const selectedRegion = config.regions.find((region) => region.id === selectedRegionId) ?? null;

  useEffect(() => {
    const stored = window.localStorage.getItem("ips-regions-config");
    const load = async () => {
      try {
        const response = await fetch("/api/regions");
        if (!response.ok) throw new Error("Config servisi yanıt vermedi");
        const payload = await response.json() as { config: RegionsConfig };
        const source = payload.config.regions.length > 0 || !stored ? payload.config : JSON.parse(stored) as RegionsConfig;
        const normalized = configWithSystemMap(source);
        setConfig(normalized);
        setSelectedRegionId(normalized.regions[0]?.id ?? null);
        setStatus("Kaydedilmiş bölgeler yüklendi");
      } catch {
        if (!stored) return;
        try {
          const normalized = configWithSystemMap(JSON.parse(stored) as RegionsConfig);
          setConfig(normalized);
          setSelectedRegionId(normalized.regions[0]?.id ?? null);
          setStatus("Yerel bölgeler yüklendi");
        } catch {
          setStatus("Config okunamadı; varsayılan config kullanılıyor");
        }
      }
    };
    void load();
  }, []);

  const updateRegion = useCallback((id: string, updater: (region: RegionDefinition) => RegionDefinition) => {
    setConfig((current) => ({ ...current, regions: current.regions.map((region) => region.id === id ? updater(region) : region) }));
    setErrors([]);
  }, []);

  const fitToScreen = useCallback(() => {
    const padding = 38;
    const scale = Math.min(
      (size.width - padding * 2) / MAP_FLOOR_PLAN.canvasSize.width,
      (size.height - padding * 2) / MAP_FLOOR_PLAN.canvasSize.height,
    );
    setViewport({
      scale: Math.max(MAP_VIEWPORT_LIMITS.minZoom, scale),
      x: (size.width - MAP_FLOOR_PLAN.canvasSize.width * scale) / 2,
      y: (size.height - MAP_FLOOR_PLAN.canvasSize.height * scale) / 2,
    });
  }, [size.height, size.width]);

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
      name: `Yeni Bölge ${number}`,
      color: "#00a896",
      polygon: [],
      roomCenter: null,
      entrances: [],
    };
    setConfig((current) => ({ ...current, regions: [...current.regions, region] }));
    setSelectedRegionId(region.id);
    setSelectedPoint(null);
    setTool("polygon");
    setStatus("Polygon köşelerini harita üzerinde işaretleyin");
  };

  const handleMapClick = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (event.target !== event.target.getStage() || tool === "select" || !selectedRegion) return;
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

  const updatePoint = (type: NonNullable<SelectedPoint>["type"], index: number, pixel: { x: number; y: number }) => {
    if (!selectedRegion) return;
    const point = withWorldCoordinates(pixel, transform);
    updateRegion(selectedRegion.id, (region) => {
      if (type === "center") return { ...region, roomCenter: point };
      if (type === "polygon") return { ...region, polygon: region.polygon.map((value, itemIndex) => itemIndex === index ? point : value) };
      return { ...region, entrances: region.entrances.map((value, itemIndex) => itemIndex === index ? { ...value, ...point } : value) };
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
    setStatus("Bölge silindi");
  };

  const saveConfig = async () => {
    const validationErrors = validateConfig(config);
    setErrors(validationErrors);
    if (validationErrors.length) {
      setStatus("Kaydetmeden önce eksikleri düzeltin");
      return;
    }
    const normalized = configWithSystemMap(config);
    window.localStorage.setItem("ips-regions-config", JSON.stringify(normalized));
    setConfig(normalized);
    try {
      const response = await fetch("/api/regions", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(normalized) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Config dosyasına yazılamadı");
      setStatus("Bölgeler config/regions.json dosyasına kaydedildi");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Config dosyasına yazılamadı"]);
      setStatus("Tarayıcıya kaydedildi; config dosyasına yazılamadı");
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
    const scale = Math.min(MAP_VIEWPORT_LIMITS.maxZoom, Math.max(MAP_VIEWPORT_LIMITS.minZoom, viewport.scale * Math.pow(1.08, direction)));
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
      <header className={styles.header}>
        <div><span>BÖLGE YÖNETİMİ / {MAP_FLOOR_PLAN.level.toUpperCase()}</span><h1>Bölgeler Paneli</h1></div>
        <div className={styles.systemMap}><Check size={14} /><span>SİSTEM HARİTASI</span><strong>{MAP_FLOOR_PLAN.name}</strong></div>
        <div className={styles.headerActions}>
          <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importConfig(file); event.currentTarget.value = ""; }} />
          <button onClick={() => fileInputRef.current?.click()}><Upload size={14} /> Config yükle</button>
          <button onClick={() => downloadJson(configWithSystemMap(config))}><Download size={14} /> Dışa aktar</button>
          <button className={styles.primary} onClick={saveConfig}><Save size={14} /> Kaydet</button>
        </div>
      </header>

      <div className={styles.editor}>
        <aside className={styles.zonePanel}>
          <div className={styles.panelTitle}><div><span>ZONE LİSTESİ</span><strong>{config.regions.length} bölge</strong></div><button onClick={addRegion} title="Yeni bölge"><Plus size={15} /></button></div>
          <div className={styles.zoneList}>
            {config.regions.length === 0 && <div className={styles.empty}><Hexagon size={24} /><strong>Henüz bölge yok</strong><span>Yeni bölge ekleyerek başlayın.</span></div>}
            {config.regions.map((region) => <button key={region.id} className={region.id === selectedRegionId ? styles.selectedZone : ""} onClick={() => { setSelectedRegionId(region.id); setSelectedPoint(null); setTool("select"); }}><i style={{ background: region.color }} /><div><strong>{region.name}</strong><span>{region.polygon.length} köşe · {region.entrances.length} giriş</span></div></button>)}
          </div>
          <div className={styles.mapInfo}><span>HARİTA KAYNAĞI</span><strong>{MAP_FLOOR_PLAN.id}</strong><small>{MAP_FLOOR_PLAN.canvasSize.width} × {MAP_FLOOR_PLAN.canvasSize.height} px</small><p>Harita sistem ayarlarından alınır ve bu ekrandan değiştirilemez.</p></div>
        </aside>

        <div ref={hostRef} className={styles.map}>
          <Stage
            ref={stageRef}
            width={size.width}
            height={size.height}
            draggable={tool === "select"}
            onWheel={handleWheel}
            onClick={handleMapClick}
            onTap={handleMapClick}
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
          </Stage>
          <div className={styles.tools}>
            {(["select", "polygon", "center", "entrance"] as const).map((value) => {
              const Icon = value === "select" ? MousePointer2 : value === "polygon" ? Hexagon : value === "center" ? Crosshair : DoorOpen;
              return <button key={value} className={tool === value ? styles.activeTool : ""} disabled={!selectedRegion && value !== "select"} onClick={() => { setTool(value); setSelectedPoint(null); }} title={TOOL_LABELS[value]}><Icon size={16} /><span>{TOOL_LABELS[value]}</span></button>;
            })}
            {tool === "polygon" && <button className={styles.finishTool} disabled={(selectedRegion?.polygon.length ?? 0) < 3} onClick={() => { setTool("select"); setStatus("Polygon tamamlandı"); }}><Check size={16} /><span>Tamamla</span></button>}
          </div>
          <div className={styles.mapControls}><button onClick={fitToScreen}>SIĞDIR</button><span>{Math.round(viewport.scale * 100)}%</span></div>
          <div className={styles.mapStatus}>{status}</div>
        </div>

        <aside className={styles.properties}>
          <div className={styles.panelTitle}><div><span>ÖZELLİKLER</span><strong>{selectedRegion ? "Seçili bölge" : "Bölge seçilmedi"}</strong></div></div>
          {!selectedRegion ? <div className={styles.empty}><MousePointer2 size={24} /><strong>Bir bölge seçin</strong><span>Özellikleri burada düzenleyebilirsiniz.</span></div> : <>
            <label><span>Bölge adı</span><input value={selectedRegion.name} onChange={(event) => updateRegion(selectedRegion.id, (region) => ({ ...region, name: event.target.value }))} /></label>
            <div className={styles.fieldRow}><label><span>Kimlik</span><input value={selectedRegion.id} readOnly /></label><label className={styles.colorField}><span>Renk</span><input type="color" value={selectedRegion.color} onChange={(event) => updateRegion(selectedRegion.id, (region) => ({ ...region, color: event.target.value }))} /></label></div>
            <div className={styles.metrics}><div><span>POLYGON</span><strong>{selectedRegion.polygon.length}</strong><small>köşe</small></div><div><span>GİRİŞLER</span><strong>{selectedRegion.entrances.length}</strong><small>nokta</small></div></div>
            <section className={styles.coordinateSection}><h2>Gerçek dünya koordinatları</h2>{selectedRegion.roomCenter ? <p>Merkez: <code>{selectedRegion.roomCenter.world.x.toFixed(2)}, {selectedRegion.roomCenter.world.y.toFixed(2)} m</code></p> : <p>Oda merkezi tanımlanmadı.</p>}<small>Pixel koordinatları sistem kalibrasyonuyla otomatik olarak metreye çevrilir.</small></section>
            {selectedPoint && <button className={styles.deletePoint} onClick={deleteSelectedPoint}><X size={14} /> Seçili noktayı sil</button>}
            {errors.length > 0 && <div className={styles.errors}>{errors.map((error) => <p key={error}>{error}</p>)}</div>}
            <button className={styles.deleteZone} onClick={deleteRegion}><Trash2 size={14} /> Bölgeyi sil</button>
          </>}
        </aside>
      </div>
    </section>
  );
}
