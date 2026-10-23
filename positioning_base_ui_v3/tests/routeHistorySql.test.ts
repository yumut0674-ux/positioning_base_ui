import assert from "node:assert/strict";
import { test } from "node:test";
import { PostgresPositionRepository } from "../src/server/location/positionRepository";
import { PostgresRoomDecisionRepository } from "../src/server/location/roomDecisionRepository";
import { ageDecision, decisionZone } from "../src/server/location/roomDecisionProjection";
import { queryPostgres } from "../src/server/postgresClient";
import type { ProcessedPosition } from "../src/server/regionEngine/types";

const enabled = process.env.ROUTE_HISTORY_DATABASE_TEST === "1";

const start = Date.parse("2026-10-15T09:00:00Z");
const at = (seconds: number) => new Date(start + seconds * 1000).toISOString();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const assignment = { entityId: 1, tagCode: "TEST", assignedAt: at(0), unassignedAt: null, usesLegacyTagModel: false };

test("PostgreSQL minute medians reject outliers and preserve floor, zone and assignment boundaries", { skip: !enabled }, async () => {
  const seed = `CREATE TEMP TABLE tag_location_history (id bigserial, tag_code text, x double precision, y double precision, pdop double precision, map_id text, zone_id text, zone_name text, created_at timestamptz);
    INSERT INTO tag_location_history(tag_code,x,y,pdop,map_id,zone_id,created_at) VALUES
      ('TEST',1000,1000,0,'floor-a','a',${quote(at(-1))}),
      ('TEST',1,2,0,'floor-a','a',${quote(at(0))}),
      ('TEST',3,4,2,'floor-a','a',${quote(at(1))}),
      ('TEST',999,999,NULL,'floor-a','a',${quote(at(2))}),
      ('TEST',20,20,NULL,'floor-b','b',${quote(at(3))}),
      ('TEST',7,8,NULL,'floor-a','a',${quote(at(4))}),
      ('TEST',9,10,NULL,'floor-a','other',${quote(at(5))}),
      ('TEST',11,12,NULL,'floor-a','other',${quote(at(60))}),
      ('TEST',13,14,NULL,'floor-a','other',${quote(at(700))}),
      ('TEST',1000,1000,0,'floor-a','a',${quote(at(701))});`;
  const repository = new PostgresPositionRepository(sql => queryPostgres(`BEGIN; ${seed} ${sql} ROLLBACK;`));
  const result = await repository.history([assignment], at(0), at(701), 2000);
  assert.equal(result.sourcePointCount, 8);
  assert.equal(result.positions.length, 6);
  assert.deepEqual(result.positions.map(p => [p.x, p.y, p.mapId, p.sourceZoneId]), [
    [3, 4, "floor-a", "a"], [20, 20, "floor-b", "b"], [7, 8, "floor-a", "a"],
    [9, 10, "floor-a", "other"], [11, 12, "floor-a", "other"], [13, 14, "floor-a", "other"],
  ]);
  assert.equal(result.positions[0].pdop, 1);
  assert.equal(result.positions[1].pdop, null);
  assert.equal(result.positions.at(-1)?.gapBeforeSeconds, 640);
  assert.equal(Date.parse(result.observedRange!.to), start + 700_000);
  const limited = await repository.history([assignment], at(0), at(701), 3);
  assert.equal(limited.positions.length, 3);
  assert.equal(limited.positions[0].x, 3);
  assert.equal(limited.positions.at(-1)?.x, 13);
  assert.equal(limited.aggregation?.pointCountBeforeLimit, 6);
  const one = await repository.history([assignment], at(0), at(701), 1);
  assert.equal(one.positions.length, 1);
  const floorOnly = await repository.history([assignment], at(0), at(701), 2000, "floor-b");
  assert.equal(floorOnly.positions.length, 1);
  assert.equal(floorOnly.sourcePointCount, 1);
  const empty = await repository.history([assignment], at(800), at(900), 2000);
  assert.equal(empty.positions.length, 0);
  assert.equal(empty.sourcePointCount, 0);
});

test("PostgreSQL aggregates a full day before applying the display limit and retains actual coverage", { skip: !enabled }, async () => {
  const seed = `CREATE TEMP TABLE tag_location_history (id bigserial, tag_code text, x double precision, y double precision, pdop double precision, map_id text, zone_id text, zone_name text, created_at timestamptz);
    INSERT INTO tag_location_history(tag_code,x,y,pdop,map_id,zone_id,created_at)
    SELECT 'TEST',i%60,i%60,0,'floor-a','a',${quote(at(0))}::timestamptz + i*interval '1 second' FROM generate_series(0,86399) i;`;
  const repository = new PostgresPositionRepository(sql => queryPostgres(`BEGIN; ${seed} ${sql} ROLLBACK;`));
  const result = await repository.history([assignment], at(0), at(86400), 2000);
  assert.equal(result.sourcePointCount, 86_400);
  assert.equal(result.positions.length, 1_440);
  assert.ok(result.positions.every(p => p.x === 29.5 && p.y === 29.5 && p.pdop === 0));
  assert.equal(Date.parse(result.observedRange!.to), start + 86_399_000);
});

test("PostgreSQL compact room visits preserve effective states across measurements, gaps and floor changes", { skip: !enabled }, async () => {
  const make = (seconds: number, room = "a", mapId = "floor-a"): ProcessedPosition => ({
    tagCode: "TEST", decisionId: `test-${seconds}`, timestamp: at(seconds), publishedAt: at(seconds), lastRawDataTimestamp: at(seconds),
    x: 50, y: 50, mapId, positionSource: "REGION_CENTER", synthetic: false,
    regionInference: { enabled: true, state: "IN_REGION", regionId: room, regionName: room, measurementKind: "measured", validUntil: at(seconds + 5), uncertainAfter: at(seconds + 30) },
  });
  const full = [...Array.from({ length: 120 }, (_, i) => make(i)), ...Array.from({ length: 15 }, (_, i) => make(120 + i, "b")), make(180, "b"), make(181, "b", "floor-b"), make(182, "b", "floor-b")];
  const seed = `CREATE TEMP TABLE tag_room_decisions (id bigint, tag_code text, published_at timestamptz, payload jsonb);
    INSERT INTO tag_room_decisions VALUES ${full.map((p, i) => `(${i},'TEST',${quote(p.publishedAt!)}::timestamptz,${quote(JSON.stringify(p))}::jsonb)`).join(",")};`;
  const repository = new PostgresRoomDecisionRepository(sql => queryPostgres(`BEGIN; ${seed} ${sql} ROLLBACK;`));
  try {
    const compact = await repository.history(["TEST"], at(0), at(220), 1000, { compact: true });
    assert.equal(compact.length, 7);
    for (let seconds = 0; seconds <= 220; seconds++) {
      const original = full.filter(p => Date.parse(p.publishedAt!) <= start + seconds * 1000).at(-1)!;
      const actual = compact.filter(p => Date.parse(p.publishedAt!) <= start + seconds * 1000).at(-1)!;
      assert.equal(decisionZone(ageDecision(actual, at(seconds))), decisionZone(ageDecision(original, at(seconds))), `${seconds}s`);
      assert.equal(actual.mapId, original.mapId);
    }
    const withSeed = await repository.history(["TEST"], at(50), at(220), 1000, { compact: true });
    assert.equal(Date.parse(withSeed[0].publishedAt!), start + 49_000);
    assert.equal(decisionZone(ageDecision(withSeed[0], at(55))), "a");
    const assigned = await repository.history(["TEST"], at(0), at(220), 1000, {
      compact: true, assignments: [{ ...assignment, assignedAt: at(30), unassignedAt: at(130) }],
    });
    assert.equal(Date.parse(assigned[0].publishedAt!), start + 30_000);
    assert.equal(Date.parse(assigned.at(-1)!.publishedAt!), start + 129_000);
  } finally { repository.stop(); }
});
