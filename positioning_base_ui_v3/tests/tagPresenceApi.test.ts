import assert from "node:assert/strict";
import test from "node:test";
import { TagPresenceService } from "../src/server/tracking/TagPresenceService";
import { createTagPresenceResponse } from "../src/server/tracking/tagPresenceHttp";

test("presence SSE starts with an atomic snapshot, publishes versioned changes and cleans up on abort", async () => {
  let now = 1_000_000;
  const service = new TagPresenceService(() => now);
  const location = { mapId: null, mapName: null, floorLabel: null, regionId: null, regionName: null, kind: "unknown" as const };
  service.observeRaw({ id: "T", x: 1, y: 2, timestamp: now }, location);
  const snapshot = () => service.snapshot();
  const json = createTagPresenceResponse(new Request("http://localhost/api/tracking/presence"), service, snapshot);
  assert.equal((await json.json()).states.length, 1);
  const abort = new AbortController();
  const response = createTagPresenceResponse(new Request("http://localhost/api/tracking/presence", {
    headers: { accept: "text/event-stream" }, signal: abort.signal,
  }), service, snapshot);
  const reader = response.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /event: snapshot/);
  const initial = JSON.parse(first.split("data: ")[1]);
  now += 60_001; service.tick();
  const next = new TextDecoder().decode((await reader.read()).value);
  assert.match(next, /event: presence/);
  const update = JSON.parse(next.split("data: ")[1]);
  assert.equal(update.epoch, initial.epoch);
  assert.ok(update.state.revision > initial.states[0].revision);
  assert.equal(update.state.hiddenForNoData, true);
  abort.abort();
  assert.equal((await reader.read()).done, true);
  service.tick();
});
