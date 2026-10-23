import assert from "node:assert/strict";
import test from "node:test";
import { buildDecisionStays } from "../src/features/history/services/decisionTimeline";
import { LocationService } from "../src/server/location/locationService";
import type { EntityRepository } from "../src/server/location/entityRepository";
import type { PositionRepository } from "../src/server/location/positionRepository";
import type { PositionRecord, TagAssignment } from "../src/server/location/location.types";
import { ageDecision, compactDecisionHistory, decisionZone, projectDecisionTimeline } from "../src/server/location/roomDecisionProjection";
import { PostgresRoomDecisionRepository, type RoomDecisionRepository } from "../src/server/location/roomDecisionRepository";
import type { ProcessedPosition } from "../src/server/regionEngine/types";

const start = Date.parse("2026-10-15T09:00:00Z");
const at = (seconds: number) => new Date(start + seconds * 1000).toISOString();
const assignment: TagAssignment = { entityId: 1, tagCode: "TEST", assignedAt: at(-3600), unassignedAt: null, usesLegacyTagModel: false };

function decision(seconds: number, room = "a", mapId = "floor-a"): ProcessedPosition {
  return {
    tagCode: "TEST", decisionId: `test-${seconds}`, timestamp: at(seconds), publishedAt: at(seconds), lastRawDataTimestamp: at(seconds),
    x: 50, y: 50, mapId, sourceZoneId: "source-a", positionSource: "REGION_CENTER", synthetic: false, engineVersion: "test",
    regionInference: { enabled: true, state: "IN_REGION", regionId: room, regionName: room, measurementKind: "measured", validUntil: at(seconds + 5), uncertainAfter: at(seconds + 30) },
  };
}

test("compact room history preserves transitions and freshness between measurements", () => {
  const full = [
    ...Array.from({ length: 120 }, (_, i) => decision(i)),
    ...Array.from({ length: 15 }, (_, i) => decision(120 + i, "b")),
    decision(180, "b"), // A real signal gap must survive compaction.
    decision(181, "b", "floor-b"), decision(182, "b", "floor-b"),
  ];
  const compact = compactDecisionHistory(full);
  assert.equal(compact.length, 7);
  for (let second = 0; second <= 220; second++) {
    const expected = full.filter(p => Date.parse(p.publishedAt!) <= start + second * 1000).at(-1)!;
    const actual = compact.filter(p => Date.parse(p.publishedAt!) <= start + second * 1000).at(-1)!;
    assert.equal(decisionZone(ageDecision(actual, at(second))), decisionZone(ageDecision(expected, at(second))), `room at ${second}s`);
    assert.equal(actual.mapId, expected.mapId, `floor at ${second}s`);
  }
  // Intermediate events must not invent inferred visits during continuous measurement.
  const events = projectDecisionTimeline([], compact, at(0), at(119));
  assert.ok(events.every(p => p.decision && decisionZone(p.decision) === "a"));
});

test("compact history handles repeated pending endpoints without losing freshness", async () => {
  const full = Array.from({ length: 60 }, (_, i) => decision(i));
  const stored = compactDecisionHistory(full);
  const repository = new PostgresRoomDecisionRepository(async () => stored.map(p => ({ payload: JSON.stringify(p) })));
  try {
    repository.record(full[0]); repository.record(full.at(-1)!);
    const compact = await repository.history(["TEST"], at(0), at(100), 1000, { compact: true });
    assert.equal(compact[0].regionInference.validUntil, full.at(-1)!.regionInference.validUntil);
  } finally { repository.stop(); }
});

test("decision stays index unsorted points by floor and keep exact interval boundaries", () => {
  const point = (seconds: number, mapId: string | null) => ({ tagId: "TEST", x: seconds, y: 1, timestamp: at(seconds), mapId });
  const points = [point(120, "floor-a"), point(30, "floor-b"), point(0, "floor-a"), point(60, "floor-a"), point(90, null)];
  const entries = [
    { zoneName: "A", mapId: "floor-a", enteredAt: at(0), exitedAt: at(60), durationSeconds: 60 },
    { zoneName: "B", mapId: "floor-b", enteredAt: at(0), exitedAt: at(60), durationSeconds: 60 },
    { zoneName: "Belirsiz", mapId: null, enteredAt: at(90), exitedAt: at(90), durationSeconds: 0 },
  ];
  const stays = buildDecisionStays(points, entries);
  assert.deepEqual(stays.map(stay => stay.positions.map(p => p.x)), [[0, 60], [30], [90]]);
  assert.equal(stays[1].isMapTransition, true);
  assert.equal(stays[2].isDataGap, true);
});

test("route response retains median coordinates, actual observed range and aggregation counts", async () => {
  const entities: EntityRepository = {
    search: async () => [], getById: async () => ({ entityId: 1, entityCode: "E", name: "Test", entityType: "asset", status: "active", aliases: [], usesLegacyTagModel: false }),
    getAssignmentAt: async () => assignment, getAssignmentsInRange: async () => [assignment],
  };
  const median: PositionRecord = { tagCode: "TEST", x: 2, y: 3, pdop: 0, mapId: "floor-a", observedAt: at(0), gapBeforeSeconds: null };
  const positions: PositionRepository = {
    latest: async () => median, nearest: async () => median, timelineHistory: async () => { throw new Error("route must not fetch raw timeline"); },
    history: async () => ({ positions: [median], sourcePointCount: 60, processingTruncated: false,
      aggregation: { method: "median", intervalSeconds: 60, pointCountBeforeLimit: 1 }, observedRange: { from: at(0), to: at(59) } }),
  };
  const decisions: RoomDecisionRepository = {
    latest: async () => null, latestMeasuredRoom: async () => null, detail: async () => null, list: async () => { throw new Error("unused"); },
    history: async (_tags, _from, _to, _limit, options) => { assert.equal(options?.compact, true); return [decision(0)]; },
  };
  const result = await new LocationService(entities, positions, () => "A", decisions).history({ entityId: 1, from: at(0), to: at(60), format: "route_points", limit: 2000 });
  assert.ok("points" in result.data);
  assert.deepEqual([result.data.points[0].x, result.data.points[0].y, result.data.points[0].pdop], [2, 3, 0]);
  assert.equal(result.data.sourcePointCount, 60);
  assert.equal(result.data.returnedCount, 1);
  assert.deepEqual(result.data.observedRange, { from: at(0), to: at(59) });
  assert.equal(result.data.aggregation?.intervalSeconds, 60);
  assert.equal(result.meta.dataStatus, "complete");
  assert.ok(result.data.zoneTimeline?.length);
});
