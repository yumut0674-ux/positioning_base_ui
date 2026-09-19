import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pointInPolygon, wallDistance } from "./geometry";
import type { CoordinatePair, DoorInferenceSettings, RegionEntrance, RegionsConfig, ResolvedRoomSettings } from "@/src/features/regions/types/region.types";
import { resolveDoorSettings, resolveGlobalSettings, resolveRoomSettings } from "../../features/regions/config/regionInferenceSettings";
import embeddedRegionsConfig from "../../../config/regions.json";
import type { CompiledRegion, CompiledRegionsConfig } from "./types";

const COUNTS = new Set(["entryConfirmationCount", "exitConfirmationCount", "maxTags", "historySize"]);
const MULTIPLIERS = new Set(["relocationEvidenceDurationMultiplier", "outsideReleaseDurationMultiplier", "regularCoverageStaleMultiplier", "intermittentCoverageStaleMultiplier", "silentCoverageStaleMultiplier", "lostAfterStaleMultiplier"]);
const SCORE_FIELDS = new Set(["baseScore", "maximumScore", "durationContributionMaximum", "measurementContributionPerSample", "measurementContributionMaximum", "doorEntryBonus", "doorExitBonus", "confirmedInsideScore", "inferredInsideMaximumScore", "invalidMeasurementMaximumScore", "minimumHardwareQuality", "reliableEvidenceWeight", "wallEvidenceWeight"]);

function finite(value: unknown, field: string, min = 0, max = 3_600_000): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${field}: geçersiz değer`);
  return value;
}

function validateSettings(settings: Record<string, unknown>, label: string, allowSystem: boolean): void {
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined || key === "doorDefaults" || key === "coverage") continue;
    if (!allowSystem && (key === "maxTags" || key === "historySize" || key === "evidenceDurationMs")) throw new Error(`${label}/${key}: yalnızca global seviyede kullanılabilir`);
    if (typeof value !== "number") continue;
    if (COUNTS.has(key)) {
      if (!Number.isInteger(value) || value < 1 || value > (key === "maxTags" ? 100_000 : key === "historySize" ? 512 : 100)) throw new Error(`${label}/${key}: pozitif tam sayı gerekli`);
    } else if (MULTIPLIERS.has(key)) finite(value, `${label}/${key}`, Number.EPSILON, 100);
    else if (SCORE_FIELDS.has(key)) finite(value, `${label}/${key}`, 0, 10);
    else finite(value, `${label}/${key}`, 0, key.includes("Meters") ? 100 : 3_600_000);
  }
}

function validateDoorSettings(settings: Partial<DoorInferenceSettings> | undefined, label: string): void {
  if (!settings) return;
  if (settings.direction !== undefined && !["bidirectional", "entry-only", "exit-only"].includes(settings.direction)) throw new Error(`${label}: kapı yönü geçersiz`);
  if (settings.evidenceMode !== undefined && !["required", "preferred", "optional", "ignored"].includes(settings.evidenceMode)) throw new Error(`${label}: evidenceMode geçersiz`);
  if (settings.evidenceMode === "required" && settings.direction && settings.direction !== "bidirectional") throw new Error(`${label}: required kapı giriş ve çıkış yönlerine izin vermelidir`);
  for (const key of ["entryEvidenceWeight", "exitEvidenceWeight", "entryConfidenceBonus", "exitConfidenceBonus"] as const) if (settings[key] !== undefined) finite(settings[key], `${label}/${key}`, 0, 10);
  for (const key of ["crossingValidityMs", "minimumDirectionalMovementMeters"] as const) if (settings[key] !== undefined) finite(settings[key], `${label}/${key}`, 0, 3_600_000);
  for (const key of ["missingDoorEvidenceDurationMultiplier", "missingDoorEvidenceCountMultiplier"] as const) if (settings[key] !== undefined) finite(settings[key], `${label}/${key}`, Number.EPSILON, 100);
}

function validateResolved(settings: ResolvedRoomSettings, label: string, historySize: number): void {
  if (settings.entryEvidenceDurationMs > settings.evidenceWindowMs) throw new Error(`${label}: giriş kanıt süresi kanıt penceresini aşamaz`);
  if (settings.exitEvidenceDurationMs > settings.evidenceWindowMs) throw new Error(`${label}: çıkış kanıt süresi kanıt penceresini aşamaz`);
  if (historySize < Math.max(settings.entryConfirmationCount, settings.exitConfirmationCount)) throw new Error(`${label}: geçmiş tamponu gereken doğrulama sayısından küçük olamaz`);
}

export function compileRegionsConfig(config: RegionsConfig): CompiledRegionsConfig {
  if (!config || !Array.isArray(config.regions)) throw new Error("Region config içinde regions listesi bulunamadı");
  validateSettings((config.engine ?? {}) as Record<string, unknown>, "Global ayarlar", true);
  validateDoorSettings(config.engine?.doorDefaults, "Global kapı varsayılanları");
  const global = resolveGlobalSettings(config.engine);
  const historySize = global.historySize;
  const globalRoom = resolveRoomSettings(config.engine);
  validateResolved(globalRoom, "Global ayarlar", historySize);
  const regions: CompiledRegion[] = []; const ids = new Set<string>(); const warnings: string[] = [];
  for (const source of config.regions) {
    if (!source.id?.trim() || ids.has(source.id)) throw new Error(`Geçersiz veya tekrar eden region id: ${source.id || "(boş)"}`);
    ids.add(source.id); const regionLabel = source.name?.trim() || source.id;
    if (source.kind && !["room", "corridor"].includes(source.kind)) throw new Error(`${regionLabel}: alan türü geçersiz`);
    if (!Array.isArray(source.polygon) || source.polygon.length < 3) throw new Error(`${regionLabel}: polygon en az 3 nokta içermeli`);
    const polygon: { readonly x: number; readonly y: number }[] = source.polygon.map((pair: CoordinatePair) => pair.world);
    if (polygon.some((p: { readonly x: number; readonly y: number }) => !Number.isFinite(p?.x) || !Number.isFinite(p?.y))) throw new Error(`${regionLabel}: polygon world koordinatları geçersiz`);
    const area = Math.abs(polygon.reduce((sum: number, p: { readonly x: number; readonly y: number }, i: number) => { const q = polygon[(i + 1) % polygon.length]; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2;
    if (area < 0.0001) throw new Error(`${regionLabel}: polygon alanı geçersiz`);
    const corridor = source.kind === "corridor" || (!source.kind && (/^corridor(?:-|$)/i.test(source.id) || /^koridor$/i.test(source.name)));
    if (corridor) continue;
    if (!source.roomCenter) { warnings.push(`${regionLabel}: merkez yok; oda çıkarımından çıkarıldı`); continue; }
    if (!Number.isFinite(source.roomCenter.world.x) || !Number.isFinite(source.roomCenter.world.y)) throw new Error(`${regionLabel}: oda merkezi geçersiz`);
    validateSettings((source.inference ?? {}) as Record<string, unknown>, regionLabel, false);
    validateDoorSettings(source.inference?.doorDefaults, `${regionLabel}/kapı varsayılanları`);
    const settings = resolveRoomSettings(config.engine, source.inference, source);
    validateResolved(settings, regionLabel, historySize);
    const doorIds = new Set<string>();
    const entrances = (source.entrances ?? []).map((entrance: RegionEntrance) => {
      const doorLabel = `${regionLabel}/${entrance.label || entrance.id}`;
      if (!entrance.id || doorIds.has(entrance.id)) throw new Error(`${doorLabel}: tekrar eden veya boş kapı kimliği`);
      doorIds.add(entrance.id); validateDoorSettings(entrance.inference, doorLabel);
      if (!Number.isFinite(entrance.world?.x) || !Number.isFinite(entrance.world?.y)) throw new Error(`${doorLabel}: kapı koordinatı geçersiz`);
      const normal = entrance.inwardNormal;
      if (normal && (!Number.isFinite(normal.x) || !Number.isFinite(normal.y) || Math.hypot(normal.x, normal.y) < 0.001)) throw new Error(`${doorLabel}: kapı normali geçersiz`);
      if (entrance.connectsTo && entrance.connectsTo !== "corridor" && !config.regions.some(r => r.id === entrance.connectsTo && r.id !== source.id)) throw new Error(`${doorLabel}: kapı bağlantısı geçersiz`);
      const doorSettings = resolveDoorSettings(settings, entrance.inference);
      if (doorSettings.evidenceMode === "required" && doorSettings.direction !== "bidirectional") throw new Error(`${doorLabel}: required kapı giriş ve çıkış yönlerine izin vermelidir`);
      if (!normal || !entrance.widthMeters || !entrance.connectsTo) warnings.push(`${doorLabel}: eksik kapı geometrisi; yönlü giriş/çıkış kanıtı kullanılamaz`);
      return { id: entrance.id, ...entrance.world, connectsTo: entrance.connectsTo, settings: doorSettings,
        inwardNormal: normal ? { x: normal.x / Math.hypot(normal.x, normal.y), y: normal.y / Math.hypot(normal.x, normal.y) } : undefined,
        widthMeters: entrance.widthMeters === undefined ? undefined : finite(entrance.widthMeters, `${doorLabel}/widthMeters`, 0.1, 20),
        approachDepthMeters: entrance.approachDepthMeters === undefined ? 2 : finite(entrance.approachDepthMeters, `${doorLabel}/approachDepthMeters`, 0.1, 20),
        crossingDepthMeters: entrance.crossingDepthMeters === undefined ? 0.15 : finite(entrance.crossingDepthMeters, `${doorLabel}/crossingDepthMeters`, 0.01, 5) };
    });
    if (!entrances.length) warnings.push(`${regionLabel}: kapı yok; yalnızca sürekli iç ölçüm ve kesinti sonrası yeniden konumlanma kullanılabilir`);
    const compiled: CompiledRegion = { id: source.id, name: source.name, coverage: settings.coverage, expectedIntervalMs: settings.expectedIntervalMs,
      wallBandMeters: settings.wallBandMeters, sharedWallBandMeters: settings.sharedWallBandMeters, settings, polygon,
      usesDoorPolicy: source.inference?.doorDefaults !== undefined || source.entrances.some((door: RegionEntrance) => door.inference !== undefined),
      roomCenter: source.roomCenter.world, entrances,
      bounds: { minX: Math.min(...polygon.map((p: { readonly x: number }) => p.x)), minY: Math.min(...polygon.map((p: { readonly y: number }) => p.y)), maxX: Math.max(...polygon.map((p: { readonly x: number }) => p.x)), maxY: Math.max(...polygon.map((p: { readonly y: number }) => p.y)) } };
    if (!pointInPolygon(compiled.roomCenter, compiled)) { warnings.push(`${regionLabel}: merkez poligon dışında; oda çıkarımından çıkarıldı, merkez düzeltilmeli`); continue; }
    if (wallDistance(compiled.roomCenter, compiled) <= settings.wallBandMeters) warnings.push(`${regionLabel}: dar oda; güvenilir iç alan yetersiz, kapı kanıtı gerekebilir`);
    for (const door of entrances) {
      if (wallDistance(door, compiled) > 0.5 && door.inwardNormal && door.widthMeters && door.connectsTo) throw new Error(`${regionLabel}/${door.id}: kapı duvardan uzak`);
      if (door.inwardNormal && !pointInPolygon({ x: door.x + door.inwardNormal.x * 0.2, y: door.y + door.inwardNormal.y * 0.2 }, compiled)) throw new Error(`${regionLabel}/${door.id}: normal odaya yönelmeli`);
    }
    regions.push(compiled);
  }
  return { version: createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 16), warnings, regions,
    rules: { ...globalRoom, maxTags: global.maxTags, historySize } };
}

export async function loadRegionsConfig(configPath = path.join(process.cwd(), "config", "regions.json")): Promise<CompiledRegionsConfig> {
  try { return compileRegionsConfig(JSON.parse(await readFile(configPath, "utf8")) as RegionsConfig); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return compileRegionsConfig(embeddedRegionsConfig as RegionsConfig); }
}

export function regionsConfigPathForMap(mapId: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(mapId)) throw new Error("INVALID_MAP_ID");
  const mapsDirectory = path.resolve(process.cwd(), "config", "maps");
  const result = path.resolve(mapsDirectory, mapId, "regions.json");
  if (!result.startsWith(`${mapsDirectory}${path.sep}`)) throw new Error("INVALID_MAP_PATH");
  return result;
}

export async function loadRegionsConfigForMap(mapId: string): Promise<CompiledRegionsConfig> {
  const value = JSON.parse(await readFile(regionsConfigPathForMap(mapId), "utf8")) as RegionsConfig;
  if (value.map?.mapId !== mapId) throw new Error("REGION_CONFIG_MAP_MISMATCH");
  return compileRegionsConfig(value);
}
