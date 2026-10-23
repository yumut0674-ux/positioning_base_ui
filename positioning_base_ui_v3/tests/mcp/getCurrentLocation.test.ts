import assert from "node:assert/strict";
import test from "node:test";
import { LocationError } from "../../src/server/location/locationErrors";
import { createGetCurrentLocationHandler } from "../../mcp/tools/getCurrentLocation";
import { currentEnvelope, FixtureClient, now, structured } from "./fixtures/testData";

test("güncel konum standart zarf, geçerli generatedAt ve İstanbul timezone döner", async () => {
  const result = await createGetCurrentLocationHandler(new FixtureClient(), now)({ entityId: 28 });
  const body = structured(result);
  assert.ok("data" in body && "meta" in body);
  const meta = body.meta as { timezone: string; generatedAt: string; dataStatus: string };
  assert.equal(meta.timezone, "Europe/Istanbul");
  assert.ok(Number.isFinite(Date.parse(meta.generatedAt)));
  assert.equal(meta.dataStatus, "complete");
});

test("aktif tag ataması yoksa güvenli TAG_ASSIGNMENT_NOT_FOUND döner", async () => {
  const client = new FixtureClient();
  client.error = new LocationError("TAG_ASSIGNMENT_NOT_FOUND");
  const result = await createGetCurrentLocationHandler(client, now)({ entityId: 28 });
  assert.equal(result.isError, true);
  assert.equal((structured(result).error as { code: string }).code, "TAG_ASSIGNMENT_NOT_FOUND");
});

test("konum kaydı yoksa LOCATION_NOT_FOUND döner", async () => {
  const client = new FixtureClient();
  client.error = new LocationError("LOCATION_NOT_FOUND");
  const result = await createGetCurrentLocationHandler(client, now)({ entityId: 28 });
  assert.equal((structured(result).error as { code: string }).code, "LOCATION_NOT_FOUND");
});

test("eski kayıt stale/offline ve dataStatus=stale döner", async () => {
  for (const status of ["stale", "offline"] as const) {
    const client = new FixtureClient();
    client.currentResponse = currentEnvelope(status);
    const result = await createGetCurrentLocationHandler(client, now)({ entityId: 28 });
    const body = structured(result);
    assert.equal((body.data as { trackingStatus: string }).trackingStatus, status);
    assert.equal((body.meta as { dataStatus: string }).dataStatus, "stale");
  }
});

test("negatif entityId VALIDATION_ERROR döner", async () => {
  const result = await createGetCurrentLocationHandler(new FixtureClient(), now)({ entityId: -1 });
  assert.equal(result.isError, true);
  assert.equal((structured(result).error as { code: string }).code, "VALIDATION_ERROR");
});
