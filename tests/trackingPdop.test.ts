import assert from "node:assert/strict";
import test from "node:test";
import { TrackingBuffer, type TrackingPosition } from "../src/server/trackingBuffer";
import { PostgresPositionRepository } from "../src/server/location/positionRepository";
import { queryPostgres, type PgRow } from "../src/server/postgresClient";
import { RegionPositionEngine } from "../src/server/regionEngine/RegionPositionEngine";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import type { RegionsConfig } from "../src/features/regions/types/region.types";
import type { ProcessedPosition } from "../src/server/regionEngine/types";
import { scenarioConfig } from "../test_api/room_scenarios.js";

const timestamp = "2026-10-13T14:30:15.123+03:00";
const position: TrackingPosition = {
  tagCode: "0000AAAABBBBCCCC", x: 1.25, y: -0.8, pdop: 1.83, timestamp,
  mapId: "map-a", sourceZoneId: "zone-a", sourceZoneName: "Bölge A",
};

test("raw buffer PDOP filtresi kayıt sorgusu, SSE, motor ve geçmiş kuyruğundan önce uygulanır", async () => {
  const calls: string[] = [], published: TrackingPosition[] = [];
  const buffer = new TrackingBuffer(async sql => {
    calls.push(sql);
    return sql.startsWith("SELECT") ? [{ tag_code: position.tagCode }] : [];
  }, () => Date.parse(timestamp), false);
  buffer.on("position", p => published.push(p));
  try {
    for (const pdop of [20.000001, 21, 1_000_000, Number.NaN, Infinity]) {
      assert.equal(await buffer.ingest({ ...position, pdop }), false);
    }
    assert.equal(calls.length, 0);
    assert.equal(published.length, 0);
    assert.equal(buffer.status().queueSize, 0);
    assert.equal(buffer.status().mappedPositionCount, 0);

    assert.equal(await buffer.ingest(position), true);
    const lastAccepted = published.at(-1);
    assert.equal(await buffer.ingest({ ...position, x: 999, y: 999, pdop: 21, timestamp: "2026-10-13T14:30:16.123+03:00" }), false);
    assert.equal(published.at(-1), lastAccepted);
    assert.equal(published.length, 1);
    assert.equal(buffer.status().queueSize, 1);
    await buffer.flush();
    assert.ok(!calls.at(-1)?.includes("999"));
  } finally { buffer.stop(); }
});

test("ham konum ve PDOP birlikte yayınlanır ve yazılır; null ile sıfır ayrı tutulur", async () => {
  const calls: string[] = [], published: TrackingPosition[] = [];
  const buffer = new TrackingBuffer(async sql => {
    calls.push(sql);
    return sql.startsWith("SELECT") ? [{ tag_code: position.tagCode }] : [];
  }, () => Date.parse(timestamp), false);
  buffer.on("position", p => published.push(p));
  try {
    for (const pdop of [1.83, 20, 0, null, undefined]) {
      assert.equal(await buffer.ingest({ ...position, pdop }), true);
    }
    assert.deepEqual(published.map(p => p.pdop), [1.83, 20, 0, null, null]);
    assert.ok(published.every(p => p.tagCode === position.tagCode && p.x === 1.25 && p.y === -0.8));
    await buffer.flush();
    const insert = calls.at(-1)!;
    assert.match(insert, /ADD COLUMN IF NOT EXISTS pdop DOUBLE PRECISION/);
    assert.match(insert, /INSERT INTO tag_location_history \([^)]*map_id, pdop\)/);
    const rows = insert.split("VALUES ")[1].split(",\n");
    assert.match(rows[0], /'map-a', 1\.83\)$/);
    assert.match(rows[1], /'map-a', 20\)$/);
    assert.match(rows[2], /'map-a', 0\)$/);
    assert.match(rows[3], /'map-a', NULL\)$/);
    assert.match(rows[4], /'map-a', NULL\);$/);
    assert.equal(buffer.status().queueSize, 0);
  } finally { buffer.stop(); }
});

test("konum repository'si güncel ve tarihsel sorgularda PDOP null ve sıfırı korur", async () => {
  const assignment = { entityId: 1, tagCode: position.tagCode, assignedAt: timestamp, unassignedAt: null, usesLegacyTagModel: false };
  for (const pdop of ["1.83", "20", "0", null]) {
    const repository = new PostgresPositionRepository(async sql => {
      assert.match(sql, /pdop::text/);
      return [{ tagCode: position.tagCode, x: "1.25", y: "-0.8", pdop, observedAt: timestamp, gapBeforeSeconds: null, sourcePointCount: "1" }];
    });
    const expected = pdop === null ? null : Number(pdop);
    assert.equal((await repository.latest(position.tagCode))?.pdop, expected);
    assert.equal((await repository.nearest(position.tagCode, timestamp, 30))?.pdop, expected);
    assert.equal((await repository.history([assignment], timestamp, "2026-10-13T15:00:00+03:00", 100)).positions[0]?.pdop, expected);
    assert.equal((await repository.timelineHistory([assignment], timestamp, "2026-10-13T15:00:00+03:00", 100)).positions[0]?.pdop, expected);
  }
});

test("oda motoru kabul edilmiş konumun PDOP değerini ham ve işlenmiş çıktıda korur", async () => {
  let now = Date.parse(timestamp);
  const published: ProcessedPosition[] = [];
  const engine = new RegionPositionEngine(p => published.push(p), 250, () => now, false);
  engine.enable(compileRegionsConfig(scenarioConfig() as RegionsConfig));
  const buffer = new TrackingBuffer(async () => [{ tag_code: position.tagCode }], () => now, false);
  buffer.on("position", p => engine.ingest(p));
  try {
    for (const pdop of [1.83, 20, 0, null]) {
      now += 1_000;
      await buffer.ingest({ ...position, x: 3, y: 3, pdop, timestamp: new Date(now).toISOString() });
      assert.equal(published.at(-1)?.pdop, pdop);
      assert.equal(published.at(-1)?.rawPosition?.pdop, pdop);
    }
    const accepted = engine.getVehicleState(position.tagCode);
    const publishedCount = published.length;
    now += 1_000;
    await buffer.ingest({ ...position, x: 99, pdop: 21, timestamp: new Date(now).toISOString() });
    assert.equal(published.length, publishedCount);
    assert.equal(engine.getVehicleState(position.tagCode)?.lastRawDataTimestamp, accepted?.lastRawDataTimestamp);
    assert.equal(engine.getVehicleState(position.tagCode)?.lastRawPosition.pdop, null);
  } finally { engine.disable(); buffer.stop(); }
});

test("PostgreSQL PDOP sütununa kabul edilen konumlarla birlikte null ve sıfır ayrı yazılır", {
  skip: process.env.TRACKING_PDOP_DATABASE_TEST !== "1",
}, async () => {
  let rows: PgRow[] = [];
  const buffer = new TrackingBuffer(async sql => {
    if (sql.startsWith("SELECT")) return [{ tag_code: position.tagCode }];
    rows = await queryPostgres(`BEGIN;
      CREATE TEMP TABLE tag_location_history (
        id BIGSERIAL PRIMARY KEY, tag_code VARCHAR(100), x DOUBLE PRECISION,
        y DOUBLE PRECISION, created_at TIMESTAMPTZ
      );
      ${sql}
      SELECT tag_code, x::text, y::text, pdop::text FROM tag_location_history ORDER BY id;
      ROLLBACK;`);
    return [];
  }, () => Date.parse(timestamp), false);
  try {
    for (const pdop of [1.83, 20, 0, null, undefined, 21]) await buffer.ingest({ ...position, pdop });
    await buffer.flush();
    assert.equal(buffer.status().error, null);
    assert.deepEqual(rows.map(p => p.pdop), ["1.83", "20", "0", null, null]);
    assert.ok(rows.every(p => p.tag_code === position.tagCode && p.x === "1.25" && p.y === "-0.8"));
  } finally { buffer.stop(); }
});
