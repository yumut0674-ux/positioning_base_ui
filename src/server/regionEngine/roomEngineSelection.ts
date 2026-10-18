import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { RegionPositionEngine } from "./RegionPositionEngine";
import { RoomHmmEngine, resolveRoomHmmSettings, type RoomHmmSettings } from "./RoomHmmEngine";
import type { ProcessedPosition } from "./types";

/**
 * Oda motoru seçimi harita başına `config/maps/<harita>/room-engine.json` dosyasıyla yapılır:
 *   { "algorithm": "hmm" }            → olasılıksal motor (room-hmm-2)
 *   { "algorithm": "evidence" }       → eski kural motoru (room-evidence-10)
 *   { "algorithm": "hmm", "hmm": { "doorProximitySigmaMeters": 0.8 } } → ayar geçersiz kılma
 * Dosya yoksa eski motor kullanılır. ROOM_ENGINE_ALGORITHM=evidence|hmm ortam değişkeni
 * tüm haritalar için dosyayı ezer (sahada hızlı geri dönüş için).
 * Bölge düzenleme paneli regions.json'u yeniden yazdığı için bu ayar bilinçli olarak ayrı dosyadadır.
 */
export type RoomEngineAlgorithm = "evidence" | "hmm";
export interface RoomEngineSelection { readonly algorithm: RoomEngineAlgorithm; readonly hmm: RoomHmmSettings; readonly source: string }
export type RoomEngine = Pick<RegionPositionEngine, "enable" | "disable" | "reload" | "ingest" | "tick" | "getStatus" | "removeVehicle">;

function parseSelection(value: unknown, source: string): RoomEngineSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source}: nesne olmalı`);
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find(key => key !== "algorithm" && key !== "hmm" && key !== "note");
  if (unknown) throw new Error(`${source}: bilinmeyen alan ${unknown}`);
  if (record.algorithm !== "hmm" && record.algorithm !== "evidence") throw new Error(`${source}: algorithm "hmm" veya "evidence" olmalı`);
  if (record.hmm !== undefined && (!record.hmm || typeof record.hmm !== "object" || Array.isArray(record.hmm))) throw new Error(`${source}: hmm nesne olmalı`);
  return { algorithm: record.algorithm, hmm: resolveRoomHmmSettings(record.hmm as Partial<RoomHmmSettings> | undefined), source };
}

function applyEnvironment(selection: RoomEngineSelection, environment: Readonly<Record<string, string | undefined>>): RoomEngineSelection {
  const forced = environment.ROOM_ENGINE_ALGORITHM?.trim().toLowerCase();
  if (!forced) return selection;
  if (forced !== "hmm" && forced !== "evidence") throw new Error("ROOM_ENGINE_ALGORITHM yalnız hmm veya evidence olabilir");
  return { ...selection, algorithm: forced, source: `${selection.source}; ROOM_ENGINE_ALGORITHM=${forced}` };
}

export function roomEngineSelectionPath(mapId: string, mapsDirectory = path.join(process.cwd(), "config", "maps")): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(mapId)) throw new Error("INVALID_MAP_ID");
  return path.join(mapsDirectory, mapId, "room-engine.json");
}

export async function readRoomEngineSelection(mapId: string, mapsDirectory?: string, environment: Readonly<Record<string, string | undefined>> = process.env): Promise<RoomEngineSelection> {
  const file = roomEngineSelectionPath(mapId, mapsDirectory);
  try { return applyEnvironment(parseSelection(JSON.parse(await readFile(file, "utf8")), file), environment); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return applyEnvironment({ algorithm: "evidence", hmm: resolveRoomHmmSettings(), source: "varsayılan (room-engine.json yok)" }, environment);
  }
}

/** Synchronous variant for offline tools that resolve the selection beside a regions.json path. */
export function readRoomEngineSelectionBeside(regionsConfigPath: string, environment: Readonly<Record<string, string | undefined>> = process.env): RoomEngineSelection {
  const file = path.join(path.dirname(regionsConfigPath), "room-engine.json");
  try { return applyEnvironment(parseSelection(JSON.parse(readFileSync(file, "utf8")), file), environment); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return applyEnvironment({ algorithm: "evidence", hmm: resolveRoomHmmSettings(), source: "varsayılan (room-engine.json yok)" }, environment);
  }
}

export function createRoomEngine(selection: { readonly algorithm: RoomEngineAlgorithm; readonly hmm?: Partial<RoomHmmSettings> }, publish: (position: ProcessedPosition) => void,
  broadcastIntervalMs: number, now: () => number = Date.now, automaticTicks = true): RoomEngine {
  return selection.algorithm === "hmm"
    ? new RoomHmmEngine(publish, broadcastIntervalMs, now, automaticTicks, selection.hmm)
    : new RegionPositionEngine(publish, broadcastIntervalMs, now, automaticTicks);
}
