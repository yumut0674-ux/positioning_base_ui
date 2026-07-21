import assert from "node:assert/strict";
import test from "node:test";
import type { LocationZone } from "../../src/features/map/config/locationZones";
import { resolveLocation } from "../../src/features/map/services/LocationResolverService";
import type { EntityRepository } from "../../src/server/location/entityRepository";
import { LocationError } from "../../src/server/location/locationErrors";
import { LocationService } from "../../src/server/location/locationService";
import type { PositionHistoryResult, PositionRepository } from "../../src/server/location/positionRepository";
import { toIstanbulIso, type EntityMatch, type PositionRecord, type TagAssignment, type TrackedEntity } from "../../src/server/location/location.types";
import { now } from "./fixtures/testData";

const entity: TrackedEntity = {
  entityId: 28, entityCode: "PALLET-028", name: "Palet 28", entityType: "product",
  status: "active", aliases: [], usesLegacyTagModel: false,
};
const oldAssignment: TagAssignment = {
  entityId: 28, tagCode: "TAG-OLD", assignedAt: "2026-07-17T00:00:00.000Z",
  unassignedAt: "2026-07-18T12:00:00.000Z", usesLegacyTagModel: false,
};
const newAssignment: TagAssignment = {
  entityId: 28, tagCode: "TAG-NEW", assignedAt: "2026-07-18T12:00:00.000Z",
  unassignedAt: null, usesLegacyTagModel: false,
};

class FakeEntities implements EntityRepository {
  public active: TagAssignment | null = newAssignment;
  public range: readonly TagAssignment[] = [oldAssignment, newAssignment];
  public search(): Promise<readonly EntityMatch[]> { return Promise.resolve([]); }
  public getById(): Promise<TrackedEntity | null> { return Promise.resolve(entity); }
  public getAssignmentAt(): Promise<TagAssignment | null> { return Promise.resolve(this.active); }
  public getAssignmentsInRange(): Promise<readonly TagAssignment[]> { return Promise.resolve(this.range); }
}

class FakePositions implements PositionRepository {
  public latestPosition: PositionRecord | null = {
    tagCode: "TAG-NEW", x: 100, y: 100,
    observedAt: "2026-07-19T11:29:50.000Z", gapBeforeSeconds: null,
  };
  public seenAssignments: readonly TagAssignment[] = [];
  public historyCallCount = 0;
  public timelineCallCount = 0;
  public timelinePositions: readonly PositionRecord[] = [
    { tagCode: "TAG-OLD", x: 7, y: 7, observedAt: "2026-07-18T13:00:00+03:00", gapBeforeSeconds: null },
    { tagCode: "TAG-NEW", x: 8, y: 8, observedAt: "2026-07-18T16:00:00+03:00", gapBeforeSeconds: 10 },
  ];
  public latest(): Promise<PositionRecord | null> { return Promise.resolve(this.latestPosition); }
  public nearest(): Promise<PositionRecord | null> { return Promise.resolve(null); }
  public history(assignments: readonly TagAssignment[]): Promise<PositionHistoryResult> {
    this.historyCallCount += 1;
    this.seenAssignments = assignments;
    return Promise.resolve({ positions: [
      { tagCode: "TAG-OLD", x: 7, y: 7, observedAt: "2026-07-18T10:00:00.000Z", gapBeforeSeconds: null },
      { tagCode: "TAG-NEW", x: 8, y: 8, observedAt: "2026-07-18T13:00:00.000Z", gapBeforeSeconds: 10 },
    ], sourcePointCount: 2, processingTruncated: false });
  }
  public timelineHistory(assignments: readonly TagAssignment[]): Promise<PositionHistoryResult> {
    this.timelineCallCount += 1;
    this.seenAssignments = assignments;
    return Promise.resolve({
      positions: this.timelinePositions,
      sourcePointCount: this.timelinePositions.length,
      processingTruncated: false,
    });
  }
}

test("zone dışı koordinat kontrollü fallback ile çözülür", async () => {
  const service = new LocationService(new FakeEntities(), new FakePositions());
  const result = await service.current(28, now);
  assert.ok(result.data.position.zoneName.length > 0);
  assert.equal(result.data.position.floorPlanId, "hq-l1");
});

test("tag başka ürüne atanmış olsa bile aralıktaki tarihsel atamalar birlikte kullanılır", async () => {
  const entities = new FakeEntities();
  const positions = new FakePositions();
  const service = new LocationService(entities, positions);
  const result = await service.history({
    entityId: 28, from: "2026-07-18T00:00:00+03:00", to: "2026-07-19T00:00:00+03:00",
    format: "route_points", limit: 2_000,
  }, now);
  assert.deepEqual(positions.seenAssignments.map((item) => item.tagCode), ["TAG-OLD", "TAG-NEW"]);
  assert.ok("points" in result.data);
  assert.deepEqual(result.data.points.map((item) => item.tagCode), ["TAG-OLD", "TAG-NEW"]);
  assert.equal(result.data.entityName, "Palet 28");
});

test("silinmiş/eski tag geçmişte görünür ama güncel aktif tag sayılmaz", async () => {
  const entities = new FakeEntities();
  entities.active = null;
  entities.range = [oldAssignment];
  const service = new LocationService(entities, new FakePositions());
  await assert.rejects(() => service.current(28, now), (error) => error instanceof LocationError && error.code === "TAG_ASSIGNMENT_NOT_FOUND");
  const history = await service.history({
    entityId: 28, from: "2026-07-18T00:00:00+03:00", to: "2026-07-18T12:00:00+03:00",
    format: "route_points", limit: 100,
  }, now);
  assert.ok("points" in history.data);
  assert.equal(history.data.points[0]?.tagCode, "TAG-OLD");
});

test("zone_timeline örneklenmemiş kayıtları oda aralıklarına birleştirir", async () => {
  const positions = new FakePositions();
  positions.timelinePositions = [
    { tagCode: "TAG-OLD", x: 1, y: 1, observedAt: "2026-07-19T10:39:28+03:00", gapBeforeSeconds: null },
    { tagCode: "TAG-OLD", x: 2, y: 1, observedAt: "2026-07-19T10:45:00+03:00", gapBeforeSeconds: 332 },
    { tagCode: "TAG-NEW", x: 20, y: 1, observedAt: "2026-07-19T10:52:14+03:00", gapBeforeSeconds: 434 },
    { tagCode: "TAG-NEW", x: 21, y: 1, observedAt: "2026-07-19T11:02:30+03:00", gapBeforeSeconds: 616 },
  ];
  // Repository gap değeri gerçek ardışık ham kaydı ifade eder. Bu testte zone birleşimini sınamak için normal akışı kullan.
  positions.timelinePositions = positions.timelinePositions.map((position, index) => ({
    ...position,
    gapBeforeSeconds: index === 0 ? null : 10,
  }));
  const resolver = (x: number) => x < 10 ? "Oda 34" : "Oda 65";
  const service = new LocationService(new FakeEntities(), positions, resolver);
  const result = await service.history({
    entityId: 28, from: "2026-07-19T10:00:00+03:00", to: "2026-07-19T11:05:00+03:00",
    format: "zone_timeline", limit: 100,
  }, now);
  assert.equal(positions.historyCallCount, 0);
  assert.equal(positions.timelineCallCount, 1);
  assert.deepEqual(positions.seenAssignments.map((assignment) => assignment.tagCode), ["TAG-OLD", "TAG-NEW"]);
  assert.deepEqual(result.data, {
    entityId: 28,
    entityName: "Palet 28",
    timeline: [
      { zoneName: "Oda 34", enteredAt: "2026-07-19T10:39:28+03:00", exitedAt: "2026-07-19T10:52:14+03:00", durationSeconds: 766 },
      { zoneName: "Oda 65", enteredAt: "2026-07-19T10:52:14+03:00", exitedAt: "2026-07-19T11:02:30+03:00", durationSeconds: 616 },
    ],
  });
  assert.equal(result.meta.timezone, "Europe/Istanbul");
  assert.ok("timeline" in result.data);
  assert.deepEqual(Object.keys(result.data.timeline[0]).sort(), ["durationSeconds", "enteredAt", "exitedAt", "zoneName"]);
});

test("beş dakikadan uzun veri boşluğu aynı zone'u iki aralığa böler", async () => {
  const positions = new FakePositions();
  positions.timelinePositions = [
    { tagCode: "TAG-NEW", x: 1, y: 1, observedAt: "2026-07-19T10:00:00+03:00", gapBeforeSeconds: null },
    { tagCode: "TAG-NEW", x: 1, y: 1, observedAt: "2026-07-19T10:10:01+03:00", gapBeforeSeconds: 601 },
  ];
  const result = await new LocationService(new FakeEntities(), positions, () => "Oda 34").history({
    entityId: 28, from: "2026-07-19T10:00:00+03:00", to: "2026-07-19T11:00:00+03:00",
    format: "zone_timeline", limit: 100,
  }, now);
  assert.ok("timeline" in result.data);
  assert.equal(result.data.timeline.length, 2);
  assert.ok(result.data.timeline.every((entry) => entry.zoneName === "Oda 34" && entry.durationSeconds === 0));
});

test("konum yoksa boş timeline ve no_data döner", async () => {
  const positions = new FakePositions();
  positions.timelinePositions = [];
  const result = await new LocationService(new FakeEntities(), positions).history({
    entityId: 28, from: "2026-07-19T10:00:00+03:00", to: "2026-07-19T11:00:00+03:00",
    format: "zone_timeline", limit: 100,
  }, now);
  assert.deepEqual(result.data, { entityId: 28, entityName: "Palet 28", timeline: [] });
  assert.equal(result.meta.dataStatus, "no_data");
});

test("polygon ve rectangle zone modelleri birlikte çalışır", () => {
  const zones: readonly LocationZone[] = [
    {
      id: "room-34", label: "Oda 34", floorPlanId: "test-floor", priority: 1,
      polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
    },
    { id: "room-65", label: "Oda 65", floorPlanId: "test-floor", priority: 2, minX: 5, maxX: 9, minY: 0, maxY: 4 },
  ];
  assert.equal(resolveLocation(2, 2, "test-floor", zones), "Oda 34");
  assert.equal(resolveLocation(6, 2, "test-floor", zones), "Oda 65");
  assert.equal(resolveLocation(20, 20, "test-floor", zones), "Tanımlı alan dışında");
});

test("PostgreSQL timestamp İstanbul ISO 8601 biçimine normalize edilir", () => {
  assert.equal(toIstanbulIso("2026-07-19 07:39:28.976+00"), "2026-07-19T10:39:28.976+03:00");
});
