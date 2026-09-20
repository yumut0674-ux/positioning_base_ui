import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveDoorSettings, resolveGlobalSettings, resolveRoomSettings } from "../src/features/regions/config/regionInferenceSettings";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import { cleanRegionsConfig, persistRegionsConfig, regionsConfigPath } from "../app/api/regions/route";
import { POST as validate } from "../app/api/regions/validate/route";
import { RegionPositionEngine } from "../src/server/regionEngine/RegionPositionEngine";
import { crossesDoor } from "../src/server/regionEngine/geometry";
import type { RegionsConfig } from "../src/features/regions/types/region.types";
import { scenarioConfig } from "../test_api/room_scenarios.js";

test("global, room and door settings resolve in priority order without mutating inputs", () => {
  const global = { entryEvidenceDurationMs: 2000, doorDefaults: { entryEvidenceWeight: 2 } };
  const room = { entryEvidenceDurationMs: 3000, doorDefaults: { entryEvidenceWeight: 3 } };
  const door = { entryEvidenceWeight: 4 };
  const snapshot = JSON.stringify({ global, room, door });
  const resolvedRoom = resolveRoomSettings(global, room);
  assert.equal(resolvedRoom.entryEvidenceDurationMs, 3000);
  assert.equal(resolveDoorSettings(resolvedRoom, door).entryEvidenceWeight, 4);
  assert.equal(resolveDoorSettings(resolvedRoom).entryEvidenceWeight, 3);
  assert.equal(resolveRoomSettings(global).entryEvidenceDurationMs, 2000);
  assert.equal(resolveGlobalSettings().entryEvidenceDurationMs, 1500);
  assert.equal(resolveRoomSettings(global).silentEntryMaxDistanceMeters, 0);
  assert.equal(resolveRoomSettings(global, { silentEntryMaxDistanceMeters: 1.5 }).silentEntryMaxDistanceMeters, 1.5);
  assert.equal(JSON.stringify({ global, room, door }), snapshot);
});

test("legacy evidenceDurationMs maps to entry and exit and legacy config compiles", () => {
  const config = scenarioConfig() as RegionsConfig;
  const compiled = compileRegionsConfig(config);
  assert.equal(compiled.rules.entryEvidenceDurationMs, 1500);
  assert.equal(compiled.rules.exitEvidenceDurationMs, 1500);
  assert.equal(compiled.regions[0].settings.entryEvidenceDurationMs, 1500);
});

test("cleaner preserves room and door overrides and rejects unknown fields", () => {
  const original = scenarioConfig() as RegionsConfig;
  const input = { ...original, engine: { ...original.engine, baseScore: .2 }, regions: original.regions.map((room, index) => ({ ...room,
    inference: { entryEvidenceDurationMs: 2000 + index, silentEntryMaxDistanceMeters: 1.5 }, entrances: room.entrances.map(door => ({ ...door, inference: { evidenceMode: "required" as const } })) })) };
  const clean = cleanRegionsConfig(input);
  assert.equal(clean.regions[0].inference?.entryEvidenceDurationMs, 2000);
  assert.equal(clean.regions[0].inference?.silentEntryMaxDistanceMeters, 1.5);
  assert.equal(clean.regions[0].entrances[0].inference?.evidenceMode, "required");
  assert.throws(() => cleanRegionsConfig({ ...input, engine: { ...input.engine, surprise: 1 } }), /bilinmeyen alan/);
  assert.throws(() => compileRegionsConfig({ ...input, regions: input.regions.map(room => ({ ...room, entrances: room.entrances.map(door => ({ ...door, inference: { evidenceMode: "required", direction: "entry-only" } })) })) } as RegionsConfig), /required kapı/);
});

test("silent proximity distance validates its finite 0..20 metre range and warns outside silent coverage", () => {
  const base=scenarioConfig() as RegionsConfig;
  const withDistance=(value:number,coverage:"silent"|"regular"="silent")=>({...base,regions:base.regions.map(room=>({...room,coverage,inference:{...room.inference,coverage,silentEntryMaxDistanceMeters:value}}))}) as RegionsConfig;
  assert.doesNotThrow(()=>compileRegionsConfig(withDistance(0)));
  assert.doesNotThrow(()=>compileRegionsConfig(withDistance(20)));
  assert.throws(()=>compileRegionsConfig(withDistance(-.01)),/silentEntryMaxDistanceMeters: geçersiz değer/);
  assert.throws(()=>compileRegionsConfig(withDistance(20.01)),/silentEntryMaxDistanceMeters: geçersiz değer/);
  assert.throws(()=>compileRegionsConfig(withDistance(Number.NaN)),/silentEntryMaxDistanceMeters: geçersiz değer/);
  assert.throws(()=>compileRegionsConfig(withDistance(null as unknown as number)),/silentEntryMaxDistanceMeters: geçersiz değer/);
  assert.throws(()=>compileRegionsConfig(withDistance("1.5" as unknown as number)),/silentEntryMaxDistanceMeters: geçersiz değer/);
  const warnings=compileRegionsConfig(withDistance(1.5,"regular")).warnings ?? [];
  assert.equal(warnings.length,base.regions.length);assert.ok(warnings.every(message=>message.includes("yalnızca sessiz kapsamada kullanılır")));
});

test("validation endpoint compiles without writing the config file", async () => {
  const before = await readFile(regionsConfigPath, "utf8");
  const response = await validate(new Request("http://localhost/api/regions/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(scenarioConfig()) }));
  assert.equal(response.status, 200); assert.equal((await response.json() as { valid: boolean }).valid, true);
  assert.equal(await readFile(regionsConfigPath, "utf8"), before);
});

test("atomic persistence round-trips overrides and failed validation keeps the last file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "regions-config-")); const target = path.join(directory, "regions.json");
  try {
    await writeFile(target, "last-working", "utf8");
    const base = scenarioConfig() as RegionsConfig;
    const input = { ...base, regions: base.regions.map(room => ({ ...room, inference: { lostAfterMs: 12345 }, entrances: room.entrances.map(door => ({ ...door, inference: { evidenceMode: "optional" as const } })) })) };
    await persistRegionsConfig(input, target);
    const saved = JSON.parse(await readFile(target, "utf8")) as RegionsConfig;
    assert.equal(saved.regions[0].inference?.lostAfterMs, 12345); assert.equal(saved.regions[0].entrances[0].inference?.evidenceMode, "optional");
    const working = await readFile(target, "utf8");
    await assert.rejects(persistRegionsConfig({ ...input, engine: { historySize: 1 } }, target));
    assert.equal(await readFile(target, "utf8"), working);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function motor(config: RegionsConfig) {
  let now = Date.parse("2026-09-01T00:00:00Z"); const engine = new RegionPositionEngine(() => undefined, 250, () => now, false);
  engine.enable(compileRegionsConfig(config));
  return (t: number, x: number, y: number) => { now = Date.parse("2026-09-01T00:00:00Z") + t; return engine.ingest({ tagCode: "T", x, y, timestamp: new Date(now).toISOString() }); };
}

test("room-specific entry duration and required/ignored door roles affect decisions", () => {
  const base = scenarioConfig() as RegionsConfig;
  const slow = { ...base, regions: base.regions.map(room => room.id === "A" ? { ...room, inference: { entryEvidenceDurationMs: 4000 } } : room) };
  const ingestSlow = motor(slow); ingestSlow(0, 3, 3); ingestSlow(1000, 3, 3); ingestSlow(2000, 3, 3);
  assert.equal(ingestSlow(3000, 3, 3)?.regionInference.state, "ENTRY_CANDIDATE");
  assert.equal(ingestSlow(4000, 3, 3)?.regionInference.regionId, "A");

  const required = { ...base, regions: base.regions.map(room => room.id === "A" ? { ...room, entrances: room.entrances.map(door => ({ ...door, inference: { evidenceMode: "required" as const } })) } : room) };
  const noCrossing = motor(required); noCrossing(0, 3, 3); noCrossing(2000, 3, 3);
  assert.equal(noCrossing(4000, 3, 3)?.regionInference.regionId, null);

  const ignored = { ...base, regions: base.regions.map(room => room.id === "A" ? { ...room, entrances: room.entrances.map(door => ({ ...door, inference: { evidenceMode: "ignored" as const } })) } : room) };
  const ignoredDoor = motor(ignored); ignoredDoor(0, 3, 3); ignoredDoor(1000, 3, 3);
  assert.equal(ignoredDoor(2000, 3, 3)?.regionInference.regionId, "A");
});

test("score components and effective config are exposed in read-only diagnostics", () => {
  const base = scenarioConfig() as RegionsConfig; let now = Date.parse("2026-09-01T00:00:00Z");
  const engine = new RegionPositionEngine(() => undefined, 250, () => now, false); engine.enable(compileRegionsConfig(base));
  engine.ingest({ tagCode: "T", x: 3, y: 3, timestamp: new Date(now).toISOString() });
  now += 1000; engine.ingest({ tagCode: "T", x: 3, y: 3, timestamp: new Date(now).toISOString() });
  const diagnostic = engine.getStatus(3000, 3001).diagnostics?.[0];
  assert.ok(diagnostic); assert.ok(diagnostic.score.total >= diagnostic.score.base); assert.ok(diagnostic.configVersion);
});

test("preferred and optional missing-door policies use their configured evidence thresholds", () => {
  const base = scenarioConfig() as RegionsConfig;
  const preferred = { ...base, regions: base.regions.map(room => room.id === "A" ? { ...room, entrances: room.entrances.map(door => ({ ...door,
    inference: { evidenceMode: "preferred" as const, missingDoorEvidenceDurationMultiplier: 3, missingDoorEvidenceCountMultiplier: 2 } })) } : room) };
  let now = Date.parse("2026-09-01T00:00:00Z"); const engine = new RegionPositionEngine(() => undefined, 250, () => now, false); engine.enable(compileRegionsConfig(preferred));
  for (const t of [0, 1000, 2000]) { now = Date.parse("2026-09-01T00:00:00Z") + t; engine.ingest({ tagCode: "T", x: 3, y: 3, timestamp: new Date(now).toISOString() }); }
  const diagnostic = engine.getStatus(3000, 3001).diagnostics?.[0];
  assert.equal(diagnostic?.requiredDurationMs, 4500); assert.equal(diagnostic?.requiredMeasurements, 4);

  const optional = { ...base, regions: base.regions.map(room => room.id === "A" ? { ...room, entrances: room.entrances.map(door => ({ ...door, inference: { evidenceMode: "optional" as const } })) } : room) };
  const ingest = motor(optional); ingest(0, 3, 3); ingest(1000, 3, 3); assert.equal(ingest(2000, 3, 3)?.regionInference.regionId, "A");
});

test("door directions, weights and crossing expiry are enforced", () => {
  const base = scenarioConfig() as RegionsConfig;
  const directed = { ...base, regions: base.regions.map(room => room.id === "A" ? { ...room, entrances: room.entrances.map(door => ({ ...door,
    inference: { direction: "entry-only" as const, entryEvidenceWeight: 2.5 } })) } : room) };
  const compiled = compileRegionsConfig(directed); const room = compiled.regions.find(item => item.id === "A")!;
  assert.equal(crossesDoor({ x: 3, y: -0.5 }, { x: 3, y: 0.5 }, room, true, "corridor", 100)?.evidenceWeight, 2.5);
  assert.equal(crossesDoor({ x: 3, y: 0.5 }, { x: 3, y: -0.5 }, room, false, "corridor", 100), null);

  const expiring = { ...base, engine: { ...base.engine, maxEvidenceGapMs: 5000 }, regions: base.regions.map(item => item.id === "A" ? { ...item,
    entrances: item.entrances.map(door => ({ ...door, inference: { evidenceMode: "required" as const, crossingValidityMs: 500 } })) } : item) };
  const ingest = motor(expiring); ingest(0, 3, -0.5); ingest(1000, 3, 0.5); ingest(2000, 3, 2); assert.equal(ingest(3000, 3, 3)?.regionInference.regionId, null);
});
