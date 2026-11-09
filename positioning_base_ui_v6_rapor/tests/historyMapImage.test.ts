import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { POST } from "../app/api/location/history-map/selection/route";
import { GET } from "../app/api/location/entities/[entityId]/history/route";
import { locationService } from "../src/server/location";
import { historyMapSegments, renderHistoryMap, renderHistorySelection } from "../src/server/location/historyMapRenderer";
import type { MapDetails } from "../src/server/maps/map.types";
import type { RoutePoint, RoutePointsHistoryData } from "../src/server/location/location.types";
import { zoomHistoryViewport } from "../src/features/history/services/historyMapViewport";

const map: MapDetails = {
  id: "test-map", image: { url: "/maps/test-map/floor.png", width: 100, height: 100 }, world: { widthMeters: 100, heightMeters: 100 },
  calibration: { worldOrigin: { x: 0, y: 0 }, canvasOrigin: { x: 0, y: 0 }, pixelsPerMeter: 1, invertYAxis: false, rotationDegrees: 0 },
  updatedAt: "2026-10-15T09:00:00Z", status: "active", liveTrackingEnabled: true,
};
const point = (seconds: number, mapId = "test-map", tagCode = "TEST"): RoutePoint => ({
  x: 10 + seconds, y: 20, tagCode, mapId, floorPlanId: mapId, zoneName: "Test", observedAt: new Date(Date.parse(map.updatedAt) + seconds * 1000).toISOString(),
});

test("history raster does not connect different floors, tags or signal gaps", () => {
  const points = [point(0), point(1), point(2, "other"), point(3), point(4, "test-map", "OTHER"), point(400, "test-map", "OTHER")];
  assert.deepEqual(historyMapSegments(points, "test-map").map(segment => segment.map(p => p.x)), [[10, 11], [13], [14], [410]]);
});

test("server composites floor and route into a single opaque WebP image", async () => {
  const floor = await sharp({ create: { width: 100, height: 100, channels: 3, background: "white" } }).png().toBuffer();
  const image = await renderHistoryMap(map, [[{ x: 20, y: 20 }, { x: 80, y: 80 }]], true, floor);
  const meta = await sharp(image).metadata();
  assert.equal(meta.format, "webp"); assert.equal(meta.width, 100); assert.equal(meta.height, 100); assert.equal(meta.hasAlpha, false);
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const start = (20 * info.width + 20) * info.channels, end = (80 * info.width + 80) * info.channels;
  assert.ok(data[start + 1] > data[start] + 50, "start marker is green");
  assert.ok(data[end] > data[end + 1] + 50, "end marker is red");
});

test("selected stay is a transparent PNG overlay with bounded raster dimensions", async () => {
  const image = await renderHistorySelection(map, [{ x: 20, y: 20 }, { x: 80, y: 80 }], false);
  const meta = await sharp(image).metadata();
  assert.equal(meta.format, "png"); assert.equal(meta.hasAlpha, true);
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0, "empty background stays transparent");
  assert.equal(data[(20 * info.width + 20) * info.channels + 3], 255, "selected points are visible");
  const large = { ...map, image: { ...map.image, width: 12_000, height: 8_000 } };
  const bounded = await sharp(await renderHistorySelection(large, [{ x: 20, y: 20 }], false)).metadata();
  assert.ok(bounded.width! <= 3840 && bounded.width! * bounded.height! <= 8_294_400);
});

test("selection image endpoint rejects invalid and oversized input and returns a PNG for a real floor", async () => {
  const request = (value: unknown) => new Request("http://localhost/api/location/history-map/selection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  assert.equal((await POST(request({ mapId: "../secret", points: [{ x: 1, y: 1 }], showRoute: false }))).status, 400);
  assert.equal((await POST(request({ mapId: "necmettin-servis", points: Array.from({ length: 2001 }, () => ({ x: 1, y: 1 })), showRoute: false }))).status, 400);
  assert.equal((await POST(request({ padding: "x".repeat(256001) }))).status, 413);
  const response = await POST(request({ mapId: "necmettin-servis", points: [{ x: 1, y: 1 }], showRoute: false }));
  assert.equal(response.status, 200); assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  assert.equal(meta.width, 3840); assert.equal(meta.height, 2160);
});

test("history API renders once from the same database result and leaves the default JSON contract intact", async () => {
  const original = locationService.history;
  let calls = 0;
  let data: RoutePointsHistoryData = { entityId: 1, entityName: "Test", from: map.updatedAt, to: "2026-10-15T10:00:00Z", format: "route_points",
    points: [point(0, "necmettin-servis"), point(60, "necmettin-servis")], gaps: [], returnedCount: 2, sourcePointCount: 120, sampled: true };
  locationService.history = async () => { calls++; return { data, meta: { timezone: "Europe/Istanbul", generatedAt: map.updatedAt, dataStatus: "complete", warnings: [] } }; };
  const url = `http://localhost/api/location/entities/1/history?from=${map.updatedAt}&to=${data.to}&format=route_points`;
  try {
    const response = await GET(new Request(`${url}&render=map`), { params: Promise.resolve({ entityId: "1" }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(calls, 1); assert.equal(result.data.renderedMaps.length, 1);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.match(result.data.renderedMaps[0].imageDataUrl, /^data:image\/webp;base64,/);
    const regular = await GET(new Request(url), { params: Promise.resolve({ entityId: "1" }) });
    assert.equal((await regular.json()).data.renderedMaps, undefined);
    data = { ...data, points: [point(0, "retired-floor"), point(60, "necmettin-servis")] };
    const legacy = await GET(new Request(`${url}&render=map`), { params: Promise.resolve({ entityId: "1" }) });
    const legacyResult = await legacy.json();
    assert.equal(legacy.status, 200);
    assert.equal(legacyResult.data.renderedMaps.length, 1);
    assert.equal(legacyResult.meta.dataStatus, "partial");
    assert.equal(legacyResult.meta.warnings.length, 1);
  } finally { locationService.history = original; }
});

test("zoom keeps the same floor coordinate under the pointer and permits fitting a wide floor on mobile", () => {
  const viewport = { x: -40, y: 30, scale: .2 }, pointer = { x: 120, y: 80 };
  const next = zoomHistoryViewport(viewport, pointer, .1);
  assert.equal((pointer.x - next.x) / next.scale, (pointer.x - viewport.x) / viewport.scale);
  assert.equal((pointer.y - next.y) / next.scale, (pointer.y - viewport.y) / viewport.scale);
  assert.equal(next.scale, .1);
  assert.equal(zoomHistoryViewport(viewport, pointer, -1).scale, .02);
  assert.equal(zoomHistoryViewport(viewport, pointer, 99).scale, 8);
});
