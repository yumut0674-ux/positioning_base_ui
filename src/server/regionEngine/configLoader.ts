import { readFile } from "node:fs/promises";
import path from "node:path";
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
  for (const source of config.regions) {
    if (!source.id?.trim() || ids.has(source.id)) throw new Error(`Geçersiz veya tekrar eden region id: ${source.id || "(boş)"}`);
    ids.add(source.id);
    if (!Array.isArray(source.polygon) || source.polygon.length < 3) throw new Error(`${source.id}: polygon en az 3 nokta içermeli`);
    const polygon = source.polygon.map((pair: CoordinatePair) => pair.world);
    if (polygon.some((point: { x: number; y: number }) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) {
      throw new Error(`${source.id}: polygon world koordinatları geçersiz`);
    }
    // Center-less regions remain editable, but are deliberately excluded from inference.
    if (!source.roomCenter) continue;
    if (!Number.isFinite(source.roomCenter.world.x) || !Number.isFinite(source.roomCenter.world.y)) {
      throw new Error(`${source.id}: roomCenter world koordinatı geçersiz`);
    }
    regions.push({
      id: source.id,
      polygon,
      roomCenter: source.roomCenter.world,
      entrances: source.entrances.map((entrance: RegionEntrance) => ({ id: entrance.id, ...entrance.world })),
      bounds: {
        minX: Math.min(...polygon.map((point: { x: number }) => point.x)),
        minY: Math.min(...polygon.map((point: { y: number }) => point.y)),
        maxX: Math.max(...polygon.map((point: { x: number }) => point.x)),
        maxY: Math.max(...polygon.map((point: { y: number }) => point.y)),
      },
    });
  }

  const engine = config.engine;
  const exitMarginMeters = engine?.exitMarginMeters ?? DEFAULT_RULES.exitMarginMeters;
  if (!Number.isFinite(exitMarginMeters) || exitMarginMeters < 0 || exitMarginMeters > 100) {
    throw new Error("exitMarginMeters 0-100 aralığında olmalıdır");
  }
  return {
    regions,
    rules: {
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
