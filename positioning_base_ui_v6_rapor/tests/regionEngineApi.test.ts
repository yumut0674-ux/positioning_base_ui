import assert from "node:assert/strict";
import test from "node:test";
import { GET, PUT } from "../app/api/region-engine/status/route";
import { ROOM_ENGINE_VERSION } from "../src/server/regionEngine/RegionPositionEngine";

function statusRequest(body: unknown): Request {
  return new Request("http://localhost/api/region-engine/status", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("region engine status GET exposes the expected backward-compatible shape", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  const status = await response.json() as Record<string, unknown>;
  for (const field of [
    "activeVehicleCount", "configLoaded", "enabled", "processedPort", "rawPort", "vehiclesInRegions",
  ]) assert.ok(field in status);
  assert.equal(status.engineVersion,ROOM_ENGINE_VERSION);
});

test("status PUT validates input and repeated disable requests are idempotent", async () => {
  assert.equal((await PUT(statusRequest({ enabled: "yes" }))).status, 400);
  assert.equal((await PUT(statusRequest({ enabled: false }))).status, 200);
  const repeated = await PUT(statusRequest({ enabled: false }));
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json() as { enabled: boolean }).enabled, false);
});
