import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { DEFAULT_REGIONS_CONFIG } from "@/src/features/regions/config/defaultRegionsConfig";
import type { RegionDefinition, RegionsConfig } from "@/src/features/regions/types/region.types";
import { compileRegionsConfig } from "@/src/server/regionEngine/configLoader";
import { regionEngineController } from "@/src/server/regionEngine/controller";

export const runtime = "nodejs";

const configPath = path.join(process.cwd(), "config", "regions.json");

function isPoint(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== "object") return false;
  const point = value as { x?: unknown; y?: unknown };
  return typeof point.x === "number" && Number.isFinite(point.x) && typeof point.y === "number" && Number.isFinite(point.y);
}

function cleanRegion(value: unknown): RegionDefinition {
  if (!value || typeof value !== "object") throw new Error("Geçersiz bölge kaydı");
  const region = value as Partial<RegionDefinition>;
  const id = region.id?.trim();
  const name = region.name?.trim();
  if (!id || !name) throw new Error("Bölge kimliği ve adı zorunludur");
  if (!Array.isArray(region.polygon) || region.polygon.length < 3) throw new Error(`${name}: polygon en az 3 nokta içermeli`);
  const cleanPair = (pair: unknown) => {
    if (!pair || typeof pair !== "object") throw new Error(`${name}: geçersiz koordinat`);
    const coordinate = pair as { pixel?: unknown; world?: unknown };
    if (!isPoint(coordinate.pixel) || !isPoint(coordinate.world)) throw new Error(`${name}: pixel ve world koordinatları zorunludur`);
    return { pixel: coordinate.pixel, world: coordinate.world };
  };
  return {
    id: id.slice(0, 100),
    name: name.slice(0, 150),
    color: /^#[0-9a-f]{6}$/i.test(region.color ?? "") ? region.color! : "#00a896",
    polygon: region.polygon.map(cleanPair),
    roomCenter: region.roomCenter ? cleanPair(region.roomCenter) : null,
    entrances: Array.isArray(region.entrances) ? region.entrances.map((entrance, index) => ({
      ...cleanPair(entrance),
      id: entrance.id?.trim().slice(0, 100) || `entrance-${index + 1}`,
      label: entrance.label?.trim().slice(0, 100) || `Giriş ${index + 1}`,
    })) : [],
  };
}

function cleanConfig(value: unknown): RegionsConfig {
  if (!value || typeof value !== "object") throw new Error("Geçersiz config");
  const body = value as { regions?: unknown; engine?: RegionsConfig["engine"] };
  if (!Array.isArray(body.regions)) throw new Error("regions alanı bir liste olmalıdır");
  const config: RegionsConfig = {
    ...DEFAULT_REGIONS_CONFIG,
    engine: { ...DEFAULT_REGIONS_CONFIG.engine, ...body.engine },
    regions: body.regions.map(cleanRegion),
  };
  compileRegionsConfig(config);
  return config;
}

export async function GET() {
  try {
    const saved = JSON.parse(await readFile(configPath, "utf8")) as RegionsConfig;
    return NextResponse.json({ config: { ...saved, map: DEFAULT_REGIONS_CONFIG.map } });
  } catch {
    return NextResponse.json({ config: DEFAULT_REGIONS_CONFIG });
  }
}

export async function PUT(request: Request) {
  try {
    const config = cleanConfig(await request.json());
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    regionEngineController.reloadConfig(config);
    return NextResponse.json({ config });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bölge config kaydı başarısız";
    return NextResponse.json({ error: message }, { status: message.includes("zorunlu") || message.includes("geçersiz") || message.includes("en az") ? 400 : 500 });
  }
}
