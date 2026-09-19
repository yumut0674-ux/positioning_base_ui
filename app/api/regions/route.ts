import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { DEFAULT_REGIONS_CONFIG } from "@/src/features/regions/config/defaultRegionsConfig";
import { DEFAULT_DOOR_INFERENCE_SETTINGS, DEFAULT_REGION_ENGINE_SETTINGS } from "@/src/features/regions/config/regionInferenceSettings";
import type { DoorInferenceOverrides, RegionDefinition, RegionsConfig, RoomInferenceSettings } from "@/src/features/regions/types/region.types";
import { compileRegionsConfig } from "@/src/server/regionEngine/configLoader";
import { regionEngineController } from "@/src/server/regionEngine/controller";
import { resolvePositionAnimationConfig } from "@/src/features/tracking/config/positionAnimationConfig";
import { resolveMapDisplayConfig } from "@/src/features/tracking/config/mapDisplayConfig";
import { mapService } from "@/src/server/maps/mapService";
import { mapIdSchema } from "@/src/server/maps/map.validation";
import { regionsConfigPathForMap } from "@/src/server/regionEngine/configLoader";

export const runtime = "nodejs";
export const regionsConfigPath = path.join(process.cwd(), "config", "regions.json");
const ENGINE_KEYS = new Set([...Object.keys(DEFAULT_REGION_ENGINE_SETTINGS), "evidenceDurationMs"]);
const DOOR_KEYS = new Set(Object.keys(DEFAULT_DOOR_INFERENCE_SETTINGS));
const ROOM_KEYS = new Set([...ENGINE_KEYS].filter(key => !["maxTags", "historySize", "doorDefaults", "evidenceDurationMs"].includes(key)).concat(["coverage", "wallBandMeters", "sharedWallBandMeters", "doorDefaults"]));

function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: geçersiz nesne`); return value as Record<string, unknown>; }
function known(value: unknown, keys: Set<string>, label: string): Record<string, unknown> {
  const record = object(value, label); const unknown = Object.keys(record).find(key => !keys.has(key)); if (unknown) throw new Error(`${label}/${unknown}: bilinmeyen alan`); return record;
}
function cleanDoorInference(value: unknown, label: string): DoorInferenceOverrides | undefined { return value === undefined ? undefined : known(value, DOOR_KEYS, label) as DoorInferenceOverrides; }
function cleanRoomInference(value: unknown, label: string): RoomInferenceSettings | undefined {
  if (value === undefined) return undefined; const record = known(value, ROOM_KEYS, label);
  return { ...record, doorDefaults: record.doorDefaults === undefined ? undefined : cleanDoorInference(record.doorDefaults, `${label}/kapı varsayılanları`) } as RoomInferenceSettings;
}
function isPoint(value: unknown): value is { x: number; y: number } { if (!value || typeof value !== "object") return false; const p = value as { x?: unknown; y?: unknown }; return typeof p.x === "number" && Number.isFinite(p.x) && typeof p.y === "number" && Number.isFinite(p.y); }

function cleanRegion(value: unknown): RegionDefinition {
  const source = object(value, "Geçersiz bölge kaydı") as Partial<RegionDefinition>; const id = source.id?.trim(), name = source.name?.trim();
  if (!id || !name) throw new Error("Bölge kimliği ve adı zorunludur"); if (!Array.isArray(source.polygon) || source.polygon.length < 3) throw new Error(`${name}: polygon en az 3 nokta içermeli`);
  const cleanPair = (pair: unknown) => { const coordinate = object(pair, `${name}: geçersiz koordinat`) as { pixel?: unknown; world?: unknown };
    if (!isPoint(coordinate.pixel) || !isPoint(coordinate.world)) throw new Error(`${name}: pixel ve world koordinatları zorunludur`); return { pixel: coordinate.pixel, world: coordinate.world }; };
  return { id: id.slice(0, 100), name: name.slice(0, 150), color: /^#[0-9a-f]{6}$/i.test(source.color ?? "") ? source.color! : "#00a896",
    polygon: source.polygon.map(cleanPair), roomCenter: source.roomCenter ? cleanPair(source.roomCenter) : null,
    coverage: source.coverage, kind: source.kind, expectedIntervalMs: source.expectedIntervalMs, wallBandMeters: source.wallBandMeters,
    sharedWallBandMeters: source.sharedWallBandMeters, inference: cleanRoomInference(source.inference, name),
    entrances: Array.isArray(source.entrances) ? source.entrances.map((entrance, index) => ({ ...cleanPair(entrance), widthMeters: entrance.widthMeters,
      inwardNormal: entrance.inwardNormal, connectsTo: entrance.connectsTo, approachDepthMeters: entrance.approachDepthMeters,
      crossingDepthMeters: entrance.crossingDepthMeters, inference: cleanDoorInference(entrance.inference, `${name}/${entrance.label || entrance.id || index + 1}`),
      id: entrance.id?.trim().slice(0, 100) || `entrance-${index + 1}`, label: entrance.label?.trim().slice(0, 100) || `Giriş ${index + 1}` })) : [] };
}

export function cleanRegionsConfig(value: unknown, expectedMapId?: string): RegionsConfig {
  const body = object(value, "Geçersiz config") as { regions?: unknown; engine?: unknown; positionAnimation?: unknown; mapDisplay?: unknown; map?: unknown };
  if (!Array.isArray(body.regions)) throw new Error("regions alanı bir liste olmalıdır");
  const rawEngine = body.engine === undefined ? {} : known(body.engine, new Set([...ENGINE_KEYS, "mode"]), "Global ayarlar");
  const engineRules = { ...rawEngine };
  delete engineRules.mode;
  const engine = { ...DEFAULT_REGION_ENGINE_SETTINGS, ...engineRules,
    doorDefaults: engineRules.doorDefaults === undefined ? DEFAULT_REGION_ENGINE_SETTINGS.doorDefaults : cleanDoorInference(engineRules.doorDefaults, "Global kapı varsayılanları") } as RegionsConfig["engine"];
  const map = (body.map ?? DEFAULT_REGIONS_CONFIG.map) as RegionsConfig["map"];
  if (!map || typeof map !== "object" || !mapIdSchema.safeParse(map.mapId).success) throw new Error("Region config map.mapId geçersiz");
  if (expectedMapId && map.mapId !== expectedMapId) throw new Error("Region config map.mapId URL mapId ile eşleşmiyor");
  const config: RegionsConfig = { ...DEFAULT_REGIONS_CONFIG, map, engine, positionAnimation: resolvePositionAnimationConfig(body.positionAnimation),
    mapDisplay: resolveMapDisplayConfig(body.mapDisplay), regions: body.regions.map(cleanRegion) };
  compileRegionsConfig(config); return config;
}

export async function persistRegionsConfig(value: unknown, targetPath = regionsConfigPath, expectedMapId?: string) {
  const config = cleanRegionsConfig(value, expectedMapId); const compiled = compileRegionsConfig(config);
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try { await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, "utf8"); await rename(temporaryPath, targetPath); }
  catch (error) { await rm(temporaryPath, { force: true }).catch(() => undefined); throw error; }
  return { config, compiled };
}

export async function GET() {
  try { const saved = JSON.parse(await readFile(regionsConfigPath, "utf8")) as RegionsConfig; const compiled = compileRegionsConfig(saved);
    return NextResponse.json({ config: { ...saved, map: DEFAULT_REGIONS_CONFIG.map, positionAnimation: resolvePositionAnimationConfig(saved.positionAnimation), mapDisplay: resolveMapDisplayConfig(saved.mapDisplay) },
      defaults: DEFAULT_REGION_ENGINE_SETTINGS, configVersion: compiled.version, warnings: compiled.warnings }); }
  catch { const compiled = compileRegionsConfig(DEFAULT_REGIONS_CONFIG); return NextResponse.json({ config: DEFAULT_REGIONS_CONFIG, defaults: DEFAULT_REGION_ENGINE_SETTINGS, configVersion: compiled.version, warnings: compiled.warnings }); }
}

export async function PUT(request: Request) {
  try { const { config, compiled } = await persistRegionsConfig(await request.json());
    regionEngineController.reloadCompiledConfig(compiled);
    return NextResponse.json({ config, configVersion: compiled.version, warnings: compiled.warnings });
  } catch (error) { const message = error instanceof Error ? error.message : "Bölge config kaydı başarısız";
    return NextResponse.json({ error: message }, { status: message.includes("kullanımda") ? 500 : 400 }); }
}

export async function getMapRegions(mapId: string) {
  const parsed = mapIdSchema.safeParse(mapId);
  if (!parsed.success) return NextResponse.json({ error: "Harita seçimi geçersiz." }, { status: 400 });
  try {
    const catalog = await mapService.getCatalog();
    const entry = catalog.maps.find((map) => map.id === parsed.data);
    if (!entry) return NextResponse.json({ error: "İstenen harita bulunamadı." }, { status: 404 });
    if (!entry.regionsConfigPath) return NextResponse.json({ error: "Bu harita için region config bulunmuyor." }, { status: 409 });
    const saved = JSON.parse(await readFile(regionsConfigPathForMap(parsed.data), "utf8")) as RegionsConfig;
    const config = cleanRegionsConfig(saved, parsed.data);
    const compiled = compileRegionsConfig(config);
    return NextResponse.json({ config, defaults: DEFAULT_REGION_ENGINE_SETTINGS, configVersion: compiled.version, warnings: compiled.warnings });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Region config okunamadı" }, { status: 500 });
  }
}

export async function putMapRegions(mapId: string, request: Request) {
  const parsed = mapIdSchema.safeParse(mapId);
  if (!parsed.success) return NextResponse.json({ error: "Harita seçimi geçersiz." }, { status: 400 });
  try {
    const catalog = await mapService.getCatalog();
    const entry = catalog.maps.find((map) => map.id === parsed.data);
    if (!entry) return NextResponse.json({ error: "İstenen harita bulunamadı." }, { status: 404 });
    if (!entry.regionsConfigPath) return NextResponse.json({ error: "Bu harita için region config bulunmuyor." }, { status: 409 });
    const { config, compiled } = await persistRegionsConfig(await request.json(), regionsConfigPathForMap(parsed.data), parsed.data);
    regionEngineController.reloadCompiledConfig(compiled, parsed.data);
    return NextResponse.json({ config, configVersion: compiled.version, warnings: compiled.warnings });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Bölge config kaydı başarısız" }, { status: 400 });
  }
}
