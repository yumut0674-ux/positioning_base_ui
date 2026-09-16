import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pointInPolygon, wallDistance } from "./geometry";
import type { CoordinatePair, RegionEntrance, RegionsConfig } from "@/src/features/regions/types/region.types";
import embeddedRegionsConfig from "../../../config/regions.json";
import type { CompiledRegion, CompiledRegionsConfig } from "./types";

const DEFAULT_RULES = { entryConfirmationCount: 2, exitConfirmationCount: 2, exitMarginMeters: 0.5 } as const;

function positiveInteger(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 100) {
    throw new Error(`${field} 1-100 aralığında bir tam sayı olmalıdır`);
  }
  return value as number;
}

export function compileRegionsConfig(config: RegionsConfig): CompiledRegionsConfig {
  if (!config || !Array.isArray(config.regions)) throw new Error("Region config içinde regions listesi bulunamadı");
  const regions: CompiledRegion[] = [];
  const ids = new Set<string>();
  const warnings: string[] = [];
  if ((config.engine?.evidenceDurationMs??1500)*2 > (config.engine?.evidenceWindowMs??12000)) throw new Error("Yeniden konumlanma kanıt süresi kanıt penceresini aşamaz");
  if (config.engine?.historySize !== undefined && config.engine.historySize < Math.max(2,config.engine?.entryConfirmationCount??2,config.engine?.exitConfirmationCount??2)) throw new Error("Geçmiş tamponu asgari kanıt sayısından küçük olamaz");
  for (const field of ["maxTags","historySize"] as const) if (config.engine?.[field] !== undefined && !Number.isInteger(config.engine[field])) throw new Error(`${field}: tam sayı gerekli`);
  const numeric = (value: number | undefined, fallback: number, field: string, min = 0, max = 3_600_000) => {
    const result = value ?? fallback;
    if (!Number.isFinite(result) || result < min || result > max) throw new Error(`${field}: geçersiz değer`);
    return result;
  };
  for (const source of config.regions) {
    if (!source.id?.trim() || ids.has(source.id)) throw new Error(`Geçersiz veya tekrar eden region id: ${source.id || "(boş)"}`);
    ids.add(source.id);
    const regionLabel = source.name?.trim() || source.id;
    if (source.kind && !["room","corridor"].includes(source.kind)) throw new Error(`${source.id}: alan türü geçersiz`);
    if (!Array.isArray(source.polygon) || source.polygon.length < 3) throw new Error(`${source.id}: polygon en az 3 nokta içermeli`);
    const polygon: { x: number; y: number }[] = source.polygon.map((pair: CoordinatePair) => pair.world);
    if (polygon.some((point: { x: number; y: number }) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) {
      throw new Error(`${source.id}: polygon world koordinatları geçersiz`);
    }
    const area = Math.abs(polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p.x*q.y-q.x*p.y;},0))/2;
    if (area < 0.0001) throw new Error(`${source.id}: polygon alanı geçersiz`);
    if (source.kind === "corridor" || (!source.kind && (/^corridor(?:-|$)/i.test(source.id) || /^koridor$/i.test(source.name)))) {
      continue;
    }
    // Center-less regions remain editable, but are deliberately excluded from inference.
    if (!source.roomCenter) { warnings.push(`${regionLabel}: merkez yok; oda çıkarımından çıkarıldı`); continue; }
    if (!Number.isFinite(source.roomCenter.world.x) || !Number.isFinite(source.roomCenter.world.y)) {
      throw new Error(`${source.id}: roomCenter world koordinatı geçersiz`);
    }
    if (source.coverage && !["silent", "intermittent", "regular"].includes(source.coverage)) throw new Error(`${source.id}: coverage geçersiz`);
    const doorIds = new Set<string>();
    const entrances = (source.entrances ?? []).map((entrance: RegionEntrance) => {
      if (!entrance.id || doorIds.has(entrance.id)) throw new Error(`${source.id}: tekrar eden veya boş kapı kimliği`);
      doorIds.add(entrance.id);
      if (!Number.isFinite(entrance.world?.x) || !Number.isFinite(entrance.world?.y)) throw new Error(`${source.id}: kapı koordinatı geçersiz`);
      const normal = entrance.inwardNormal;
      if (normal && (!Number.isFinite(normal.x) || !Number.isFinite(normal.y) || Math.hypot(normal.x, normal.y) < 0.001)) throw new Error(`${source.id}: kapı normali geçersiz`);
      if (entrance.connectsTo && entrance.connectsTo !== "corridor" && !config.regions.some(r => r.id === entrance.connectsTo && r.id !== source.id)) throw new Error(`${source.id}: kapı bağlantısı geçersiz`);
      if (!normal || !entrance.widthMeters || !entrance.connectsTo) warnings.push(`${regionLabel}/${entrance.label || entrance.id}: eksik kapı geometrisi; yönlü giriş/çıkış kanıtı kullanılamaz`);
      return { id: entrance.id, ...entrance.world, connectsTo: entrance.connectsTo,
        inwardNormal: normal ? { x: normal.x / Math.hypot(normal.x, normal.y), y: normal.y / Math.hypot(normal.x, normal.y) } : undefined,
        widthMeters: entrance.widthMeters === undefined ? undefined : numeric(entrance.widthMeters, 1, "widthMeters", 0.1, 20),
        approachDepthMeters: numeric(entrance.approachDepthMeters, 2, "approachDepthMeters", 0.1, 20),
        crossingDepthMeters: numeric(entrance.crossingDepthMeters, 0.15, "crossingDepthMeters", 0.01, 5) };
    });
    if (!entrances.length) warnings.push(`${regionLabel}: kapı yok; yalnızca sürekli iç ölçüm ve kesinti sonrası yeniden konumlanma kullanılabilir`);
    const compiled: CompiledRegion = {
      id: source.id,
      name: source.name,
      coverage: source.coverage ?? "regular",
      expectedIntervalMs: source.expectedIntervalMs === undefined ? config.engine?.expectedIntervalMs : numeric(source.expectedIntervalMs, 1000, "expectedIntervalMs", 50),
      wallBandMeters: numeric(source.wallBandMeters, 0.35, "wallBandMeters", 0, 10),
      sharedWallBandMeters: numeric(source.sharedWallBandMeters, 0.65, "sharedWallBandMeters", 0, 10),
      polygon,
      roomCenter: source.roomCenter.world,
      entrances,
      bounds: {
        minX: Math.min(...polygon.map((point: { x: number }) => point.x)),
        minY: Math.min(...polygon.map((point: { y: number }) => point.y)),
        maxX: Math.max(...polygon.map((point: { x: number }) => point.x)),
        maxY: Math.max(...polygon.map((point: { y: number }) => point.y)),
      },
    };
    if (!pointInPolygon(compiled.roomCenter, compiled)) { warnings.push(`${regionLabel}: merkez poligon dışında; oda çıkarımından çıkarıldı, merkez düzeltilmeli`); continue; }
    if (wallDistance(compiled.roomCenter, compiled) <= compiled.wallBandMeters!) warnings.push(`${regionLabel}: dar oda; güvenilir iç alan yetersiz, kapı kanıtı gerekebilir`);
    for (const door of entrances) {
      if (wallDistance(door, compiled) > 0.5 && door.inwardNormal && door.widthMeters && door.connectsTo) throw new Error(`${source.id}/${door.id}: kapı duvardan uzak`);
      if (door.inwardNormal && !pointInPolygon({ x: door.x + door.inwardNormal.x * 0.2, y: door.y + door.inwardNormal.y * 0.2 }, compiled)) throw new Error(`${source.id}/${door.id}: normal odaya yönelmeli`);
    }
    regions.push(compiled);
  }

  const engine = config.engine;
  const exitMarginMeters = engine?.exitMarginMeters ?? DEFAULT_RULES.exitMarginMeters;
  if (!Number.isFinite(exitMarginMeters) || exitMarginMeters < 0 || exitMarginMeters > 100) {
    throw new Error("exitMarginMeters 0-100 aralığında olmalıdır");
  }
  return {
    version: createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 16),
    warnings,
    regions,
    rules: {
      evidenceDurationMs: numeric(engine?.evidenceDurationMs, 1500, "evidenceDurationMs", 100),
      evidenceWindowMs: numeric(engine?.evidenceWindowMs, 12000, "evidenceWindowMs", 1000),
      maxEvidenceGapMs: numeric(engine?.maxEvidenceGapMs, 4000, "maxEvidenceGapMs", 100),
      expectedIntervalMs: numeric(engine?.expectedIntervalMs, 1000, "expectedIntervalMs", 50),
      maxSpeedMetersPerSecond: numeric(engine?.maxSpeedMetersPerSecond, 4, "maxSpeedMetersPerSecond", 0.1, 100),
      lostAfterMs: numeric(engine?.lostAfterMs, 30000, "lostAfterMs", 1000),
      relocationAfterMs: numeric(engine?.relocationAfterMs, 15000, "relocationAfterMs", 1000),
      maxTags: numeric(engine?.maxTags, 5000, "maxTags", 1, 100000),
      historySize: numeric(engine?.historySize, Math.max(64,engine?.entryConfirmationCount??2,engine?.exitConfirmationCount??2), "historySize", 3, 512),
      entryConfirmationCount: positiveInteger(engine?.entryConfirmationCount, DEFAULT_RULES.entryConfirmationCount, "entryConfirmationCount"),
      exitConfirmationCount: positiveInteger(engine?.exitConfirmationCount, DEFAULT_RULES.exitConfirmationCount, "exitConfirmationCount"),
      exitMarginMeters,
    },
  };
}

export async function loadRegionsConfig(configPath = path.join(process.cwd(), "config", "regions.json")): Promise<CompiledRegionsConfig> {
  try {
    return compileRegionsConfig(JSON.parse(await readFile(configPath, "utf8")) as RegionsConfig);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // vinext bundles API routes under /bundle; keep the checked-in config available there.
    return compileRegionsConfig(embeddedRegionsConfig as RegionsConfig);
  }
}
