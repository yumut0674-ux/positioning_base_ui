import assert from "node:assert/strict";
import test from "node:test";
import { LocationError } from "../../src/server/location/locationErrors";
import { createGetLocationHistoryHandler } from "../../mcp/tools/getLocationHistory";
import { FixtureClient, now, structured, zoneTimelineEnvelope } from "./fixtures/testData";

const validInput = {
  entityId: 28, from: "2026-07-18T00:00:00+03:00", to: "2026-07-19T00:00:00+03:00",
  format: "route_points" as const, limit: 2_000,
};

test("route_points geçmişi sınırlı standart zarfla döner", async () => {
  const result = await createGetLocationHistoryHandler(new FixtureClient(), now)(validInput);
  const data = structured(result).data as { points: unknown[]; returnedCount: number };
  assert.equal(data.points.length, 1);
  assert.equal(data.returnedCount, 1);
});

test("MCP zone_timeline REST sözleşmesini ek alan üretmeden korur", async () => {
  const client = new FixtureClient();
  client.historyResponse = zoneTimelineEnvelope();
  const result = await createGetLocationHistoryHandler(client, now)({ ...validInput, format: "zone_timeline" });
  const data = structured(result).data as { entityId: number; entityName: string; timeline: Record<string, unknown>[] };
  assert.equal(data.entityName, "Palet 28");
  assert.deepEqual(Object.keys(data).sort(), ["entityId", "entityName", "timeline"]);
  assert.deepEqual(Object.keys(data.timeline[0]).sort(), ["durationSeconds", "enteredAt", "exitedAt", "zoneName"]);
  for (const forbidden of ["x", "y", "battery", "tagCode", "floorPlanId", "pointCount"]) {
    assert.equal(forbidden in data.timeline[0], false);
  }
});

test("başlangıç bitişten sonraysa INVALID_DATE_RANGE döner", async () => {
  const client = new FixtureClient();
  client.error = new LocationError("INVALID_DATE_RANGE");
  const result = await createGetLocationHistoryHandler(client, now)({ ...validInput, from: validInput.to, to: validInput.from });
  assert.equal((structured(result).error as { code: string }).code, "INVALID_DATE_RANGE");
});

test("çok uzun tarih aralığı DATE_RANGE_TOO_LARGE döner", async () => {
  const client = new FixtureClient();
  client.error = new LocationError("DATE_RANGE_TOO_LARGE", { details: { maxDays: 7 } });
  const result = await createGetLocationHistoryHandler(client, now)({
    ...validInput, from: "2026-07-01T00:00:00+03:00",
  });
  assert.equal((structured(result).error as { code: string }).code, "DATE_RANGE_TOO_LARGE");
});

test("history limit 2000 üstünde VALIDATION_ERROR döner", async () => {
  const result = await createGetLocationHistoryHandler(new FixtureClient(), now)({ ...validInput, limit: 2_001 });
  assert.equal((structured(result).error as { code: string }).code, "VALIDATION_ERROR");
});
