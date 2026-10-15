import assert from "node:assert/strict";
import test from "node:test";
import { PostgresTagPresenceRepository } from "../src/server/tracking/tagPresenceRepository";
import type { PersistedTagObservation } from "../src/features/tracking/types/tagPresence.types";

test("presence persistence keeps only registered tags, orders upserts by measurement and restores valid raw observations", async () => {
  const observation: PersistedTagObservation = { tagCode: "T'1", raw: { id: "T'1", x: 2, y: 3, timestamp: 1_000, mapId: "map-a" },
    lastRawMeasuredAt: 1_000, lastRawReceivedAt: 1_001,
    lastObservedLocation: { mapId: "map-a", mapName: "1. Kat", floorLabel: "Kat 1", regionId: "A", regionName: "Oda 103", kind: "room" } };
  const queries: string[] = [];
  const repository = new PostgresTagPresenceRepository(async sql => {
    queries.push(sql);
    return sql.includes("SELECT p.payload") ? [{ payload: JSON.stringify(observation) }, { payload: "broken" }, { payload: "{}" }] : [];
  });
  await repository.save([observation]);
  assert.match(queries[0], /CREATE TABLE IF NOT EXISTS tag_presence_state/);
  assert.match(queries[1], /WHERE EXISTS \(SELECT 1 FROM tags/);
  assert.match(queries[1], /EXCLUDED.measured_at > tag_presence_state.measured_at/);
  assert.match(queries[1], /T''1/);
  assert.deepEqual(await repository.restore(), [observation]);
  assert.match(queries[2], /INNER JOIN tags/);
  assert.doesNotMatch(queries.join("\n"), /DELETE|DROP|tag_location_history|tag_room_decisions/);
});

test("a schema/persistence failure is reported and a later save can retry", async () => {
  let fail = true, schemas = 0;
  const repository = new PostgresTagPresenceRepository(async sql => {
    if (sql.includes("CREATE TABLE")) { schemas++; if (fail) throw new Error("database unavailable"); }
    return [];
  });
  await assert.rejects(repository.restore(), /database unavailable/);
  fail = false;
  assert.deepEqual(await repository.restore(), []);
  assert.equal(schemas, 2);
});
