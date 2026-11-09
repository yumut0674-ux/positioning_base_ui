import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./fixtures/pacemaker2-exit-20261023.json";
import { AreaExitReader } from "../src/server/tracking/areaExitReader";
import { createAreaExitResponse } from "../src/server/tracking/areaExitHttp";
import { useIpsStore } from "../src/app/store/useIpsStore";
import { TagPresenceService } from "../src/server/tracking/TagPresenceService";
import { visibleAreaExit } from "../src/features/tracking/services/tagPresencePresentation";
import type { ProcessedPosition } from "../src/server/regionEngine/types";

const recorded = fixture.records.at(-1)!.decision as ProcessedPosition;
const tag = fixture.tagCode;
const at = "2026-10-23T16:35:00.000Z";

test("exit reader uses existing history with SELECT only and does not mutate published decisions", async () => {
  const statements: string[] = [];
  const before = JSON.stringify(recorded);
  const reader = new AreaExitReader(async sql => {
    statements.push(sql); return [{ tag_code: tag, payload: JSON.stringify(recorded) }];
  }, () => []);
  const result = await reader.read([tag.toLowerCase()], at);
  assert.equal(result.byTag[tag].exit!.exitedAt, "2026-10-23T15:50:46.305Z");
  assert.equal(result.byTag[tag].exit!.gateName, "Ameliyathane giriş / çıkış kapısı");
  assert.equal(result.byTag[tag].exit!.areaName, "Yoğun Bakım");
  assert.equal(JSON.stringify(recorded), before);
  assert.match(statements[0], /LEFT JOIN LATERAL/);
  assert.doesNotMatch(statements.join("\n"), /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});

test("a newer unpublished-to-DB inside decision supersedes the earlier exit; unknown tags and future outputs are excluded", async () => {
  const inside: ProcessedPosition = { ...recorded, publishedAt: "2026-10-23T16:00:00.000Z",
    regionInference: { enabled: true, state: "INFERRED_IN_REGION", regionId: "room-07", measurementKind: "estimated" } };
  const reader = new AreaExitReader(async () => [{ tag_code: tag, payload: JSON.stringify(recorded) }], () => [
    inside, { ...recorded, tagCode: "UNREGISTERED" }, { ...recorded, publishedAt: "2026-10-23T17:00:00Z" },
  ]);
  const result = await reader.read([tag, "UNREGISTERED"], at);
  assert.equal(result.byTag[tag].exit, null);
  assert.equal(result.byTag[tag].publishedAt, inside.publishedAt);
  assert.equal(result.byTag.UNREGISTERED, undefined);
});

test("display history changes neither client tracking objects nor presence; delayed history cannot replace newer display history", async () => {
  const original = useIpsStore.getState();
  try {
    const reader = new AreaExitReader(async () => [{ tag_code: tag, payload: JSON.stringify(recorded) }], () => []);
    const snapshot = await reader.read([tag], at);
    const before = useIpsStore.getState();
    useIpsStore.getState().applyAreaExitSnapshot(snapshot);
    const after = useIpsStore.getState();
    for (const key of ["tags", "observedTags", "tagPresenceById", "tagLocationEntries", "mapTagDisplays", "activeMapId"] as const) {
      assert.equal(after[key], before[key], key);
    }
    const noExit = { ...snapshot, serverNow: snapshot.serverNow + 1, byTag: { [tag]: { tagCode: tag, publishedAt: at, exit: null } } };
    after.applyAreaExitSnapshot(noExit);
    after.applyAreaExitSnapshot(snapshot);
    assert.equal(useIpsStore.getState().areaExitByTag[tag].exit, null);
  } finally { useIpsStore.setState(original, true); }
});

test("an API read failure and invalid input cannot change tracking state", async () => {
  const service = new TagPresenceService(() => Date.parse(at));
  service.observeRaw({ id: tag, x: 2, y: 22.1, timestamp: Date.parse(at), mapId: recorded.mapId }, {
    mapId: recorded.mapId!, mapName: "Yoğun Bakım", floorLabel: null, regionId: null, regionName: null, kind: "unknown",
  });
  const before = structuredClone(service.snapshot());
  let reads = 0;
  const broken = { read: async () => { reads++; throw new Error("Database unavailable"); } };
  const response = await createAreaExitResponse(new Request(`http://localhost/api/tracking/area-exits?tag=${tag}`), broken);
  assert.equal(response.status, 503);
  assert.deepEqual(service.snapshot(), before);
  assert.equal((await createAreaExitResponse(new Request("http://localhost/api/tracking/area-exits"), broken)).status, 400);
  assert.equal(reads, 1);
});

test("a newer live re-entry hides a delayed archive exit response without changing the decision", async () => {
  const reader = new AreaExitReader(async () => [{ tag_code: tag, payload: JSON.stringify(recorded) }], () => []);
  const status = (await reader.read([tag], at)).byTag[tag];
  const now = Date.parse(at);
  const service = new TagPresenceService(() => now);
  const raw = { id: tag, x: 1, y: 2, timestamp: now, mapId: recorded.mapId };
  service.observeRaw(raw, { mapId: recorded.mapId!, mapName: "Yoğun Bakım", floorLabel: null, regionId: null, regionName: null, kind: "unknown" });
  service.observeDecision({ ...raw, publishedAt: at, regionInference: { enabled: true, state: "IN_REGION", regionId: "room-07" } });
  const before = structuredClone(service.snapshot());
  assert.equal(visibleAreaExit(service.get(tag), status), undefined);
  assert.deepEqual(service.snapshot(), before);
});
