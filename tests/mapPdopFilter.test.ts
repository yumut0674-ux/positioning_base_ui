import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_PDOP_FILTER_SETTINGS, isPositionPdopAccepted, parsePdopFilterSettings } from "../src/shared/tracking/pdop";
import { MapTrackingFilterSettings, mapTrackingFilterSettings, TrackingFilterConfigurationError } from "../src/server/trackingFilterSettings";
import { createTrackingFilterHandlers } from "../src/server/trackingFilterHttp";
import { mapService } from "../src/server/maps/mapService";
import { TrackingBuffer } from "../src/server/trackingBuffer";
import { RegionPositionEngine } from "../src/server/regionEngine/RegionPositionEngine";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import type { RegionsConfig } from "../src/features/regions/types/region.types";
import type { ProcessedPosition } from "../src/server/regionEngine/types";
import { scenarioConfig } from "../test_api/room_scenarios.js";

const intensiveCare = "necmettin-yogun-bakim";
const service = "necmettin-servis";

function request(value: unknown) {
  return new Request("http://localhost/api/maps/necmettin-yogun-bakim/tracking-filter", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(value),
  });
}

test("yoğun bakım haritası PDOP 70 ile başlar, diğer haritalar ve bilinmeyen kat 20 kullanır", async () => {
  assert.deepEqual(await mapTrackingFilterSettings.read(intensiveCare, true), { enabled: true, maximumPdop: 70 });
  assert.deepEqual(await mapTrackingFilterSettings.read(service, true), DEFAULT_PDOP_FILTER_SETTINGS);
  assert.deepEqual(await mapTrackingFilterSettings.read(null), DEFAULT_PDOP_FILTER_SETTINGS);
  assert.ok(isPositionPdopAccepted(70, { enabled: true, maximumPdop: 70 }));
  assert.ok(!isPositionPdopAccepted(70.000001, { enabled: true, maximumPdop: 70 }));
  assert.ok(!isPositionPdopAccepted(21, DEFAULT_PDOP_FILTER_SETTINGS));
});

test("kapatılan PDOP filtresi sonlu sayıları kabul eder; null ve sıfır korunur", () => {
  for (const pdop of [null, undefined, 0, 70, 1_000_000]) assert.ok(isPositionPdopAccepted(pdop, { enabled: false, maximumPdop: 20 }));
  for (const pdop of [NaN, Infinity, -Infinity]) assert.ok(!isPositionPdopAccepted(pdop, { enabled: false, maximumPdop: 20 }));
  for (const value of [{ enabled: "true", maximumPdop: 70 }, { enabled: true, maximumPdop: "70" },
    { enabled: true, maximumPdop: -1 }, { enabled: true, maximumPdop: Infinity }, { enabled: true, maximumPdop: NaN },
    { enabled: true, maximumPdop: 70, hdop: 10 }, {}, null]) assert.throws(() => parsePdopFilterSettings(value));
});

test("PDOP ayarları harita bazında kalıcıdır; kaydetme cache'e hemen yansır ve diğer haritayı değiştirmez", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "map-pdop-"));
  let now = 1_000;
  const settings = new MapTrackingFilterSettings(directory, 1_000, () => now);
  try {
    assert.deepEqual(await settings.read(intensiveCare), DEFAULT_PDOP_FILTER_SETTINGS);
    assert.deepEqual(await settings.read(service), DEFAULT_PDOP_FILTER_SETTINGS);
    await settings.save(intensiveCare, { enabled: true, maximumPdop: 70 });
    assert.deepEqual(await settings.read(intensiveCare), { enabled: true, maximumPdop: 70 });
    assert.deepEqual(await settings.read(service), DEFAULT_PDOP_FILTER_SETTINGS);
    const restarted = new MapTrackingFilterSettings(directory);
    assert.deepEqual(await restarted.read(intensiveCare), { enabled: true, maximumPdop: 70 });
    await settings.save(intensiveCare, { enabled: false, maximumPdop: 70 });
    assert.deepEqual(await settings.read(intensiveCare), { enabled: false, maximumPdop: 70 });
    const target = path.join(directory, intensiveCare, "tracking-filter.json");
    const before = await readFile(target, "utf8");
    assert.throws(() => settings.save(intensiveCare, { enabled: true, maximumPdop: -1 }));
    assert.equal(await readFile(target, "utf8"), before);
    await writeFile(target, '{"enabled":true,"maximumPdop":60}', "utf8");
    now += 1_001;
    assert.deepEqual(await settings.read(intensiveCare), { enabled: true, maximumPdop: 60 });
    await writeFile(target, '{"enabled":true,"maximumPdop":"bad"}', "utf8");
    now += 1_001;
    await assert.rejects(() => settings.read(intensiveCare), TrackingFilterConfigurationError);
    await assert.rejects(() => settings.read("../escape"), /Harita seçimi/);
    assert.throws(() => settings.save("../escape", DEFAULT_PDOP_FILTER_SETTINGS), /Harita seçimi/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("harita filtre API'si ayarları kaydeder; hatalı ayar ve harita seçimi dosyayı değiştirmez", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "map-pdop-http-"));
  const settings = new MapTrackingFilterSettings(directory);
  const api = createTrackingFilterHandlers(mapService, settings);
  try {
    const initial = await api.get(intensiveCare);
    assert.equal(initial.status, 200);
    assert.equal(initial.headers.get("cache-control"), "no-store");
    const saved = await api.put(intensiveCare, request({ enabled: true, maximumPdop: 70 }));
    assert.equal(saved.status, 200);
    assert.deepEqual((await saved.json()).settings, { enabled: true, maximumPdop: 70 });
    assert.deepEqual((await (await api.get(service)).json()).settings, DEFAULT_PDOP_FILTER_SETTINGS);
    assert.equal((await api.put(intensiveCare, request({ enabled: true, maximumPdop: "70" }))).status, 400);
    assert.deepEqual(await settings.read(intensiveCare), { enabled: true, maximumPdop: 70 });
    assert.equal((await api.get("../escape")).status, 400);
    assert.equal((await api.put("missing-map", request(DEFAULT_PDOP_FILTER_SETTINGS))).status, 404);
    assert.equal((await api.put("kat1-ornek-birim", request(DEFAULT_PDOP_FILTER_SETTINGS))).status, 409);
    assert.equal((await api.put(intensiveCare, request({ enabled: false, maximumPdop: 70 }))).status, 200);
    assert.deepEqual((await (await api.get(intensiveCare)).json()).settings, { enabled: false, maximumPdop: 70 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("eşik güncelleme ve açma/kapatma motor durumunu sıfırlamaz; kabul edilen veriye mevcut oda algoritması uygulanır", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "map-pdop-motor-"));
  const settings = new MapTrackingFilterSettings(directory);
  const api = createTrackingFilterHandlers(mapService, settings);
  const published: ProcessedPosition[] = [];
  let now = Date.parse("2026-10-13T14:30:15.123+03:00");
  const engineConfig = scenarioConfig() as RegionsConfig;
  const engine = new RegionPositionEngine(p => published.push(p), 250, () => now, false);
  engine.enable(compileRegionsConfig(engineConfig));
  const buffer = new TrackingBuffer(async () => [{ tag_code: "PDOP-ROOM" }], () => now, false, mapId => settings.read(mapId));
  buffer.on("position", p => engine.ingest(p));
  const point = (pdop: number | null, x = 3) => { now += 1_000; return buffer.ingest({ tagCode: "PDOP-ROOM", x, y: 3, pdop, timestamp: new Date(now).toISOString(), mapId: intensiveCare }); };
  try {
    const compiledBefore = compileRegionsConfig(engineConfig);
    await api.put(intensiveCare, request({ enabled: true, maximumPdop: 70 }));
    for (let i = 0; i < 3; i++) assert.equal(await point(50), true);
    assert.equal(published.at(-1)?.regionInference.state, "IN_REGION");
    const stateBefore = JSON.stringify(engine.getVehicleState("PDOP-ROOM"));
    const countBefore = published.length;
    await api.put(intensiveCare, request({ enabled: true, maximumPdop: 40 }));
    assert.equal(JSON.stringify(engine.getVehicleState("PDOP-ROOM")), stateBefore);
    assert.equal(await point(50), false);
    assert.equal(published.length, countBefore);
    assert.equal(JSON.stringify(engine.getVehicleState("PDOP-ROOM")), stateBefore);
    await api.put(intensiveCare, request({ enabled: false, maximumPdop: 40 }));
    assert.equal(JSON.stringify(engine.getVehicleState("PDOP-ROOM")), stateBefore);
    assert.equal(await point(100), true);
    assert.equal(published.at(-1)?.pdop, 100);
    assert.equal(published.at(-1)?.regionInference.state, "IN_REGION");
    // Turning PDOP off does not turn the speed, distance or room-evidence filters off.
    assert.equal(await point(100, 999), true);
    assert.equal(published.at(-1)?.decisionTrace?.eventType, "MEASUREMENT_REJECTED");
    assert.ok(published.at(-1)?.decisionTrace?.reasons.some(reason => reason.code === "MEASUREMENT_REJECTED_BY_SPEED"));
    assert.deepEqual(compileRegionsConfig(engineConfig), compiledBefore);
  } finally { buffer.stop(); engine.disable(); await rm(directory, { recursive: true, force: true }); }
});
