import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileMapRepository } from "../src/server/maps/mapRepository";
import { MapRequestError, MapService } from "../src/server/maps/mapService";
import { GET as getMapRoute } from "../app/api/maps/[mapId]/route";
import { GET as getMapRegionsRoute } from "../app/api/maps/[mapId]/regions/route";
import { createAffineTransform } from "../src/features/regions/services/affineTransform";
import { CoordinateTransformService } from "../src/features/map/services/CoordinateTransformService";
import { ZoneMapResolver } from "../src/server/maps/zoneMapResolver";
import { parsePositionPayload } from "../app/api/tracking/ingest/route";
import type { RegionsConfig } from "../src/features/regions/types/region.types";

const mapsDirectory = path.join(process.cwd(), "config", "maps");

test("Servis motor zone resolves to the active service floor", async () => {
  const repository = new FileMapRepository(mapsDirectory);
  const catalog = await repository.readCatalog();
  const serviceFloor = catalog.maps.find((entry) => entry.id === "necmettin-servis")!;
  assert.equal(serviceFloor.displayName, "Servis");
  assert.equal(serviceFloor.floorLabel, "Servis");
  assert.equal(serviceFloor.status, "active");
  assert.equal(serviceFloor.liveTrackingEnabled, true);
  const position = parsePositionPayload({
    type: "position", tag_id: "SERVIS-1", x: 10, y: 5,
    timestamp: "2026-10-09T11:30:00Z", zone_id: "servis", zone_name: "Servis",
  });
  const resolver = new ZoneMapResolver(repository);
  const expected = { mapId: serviceFloor.id, resolved: true };
  assert.deepEqual(await resolver.resolve(position.sourceZoneId ?? null), expected);
  assert.deepEqual(await resolver.resolve("Servis"), expected);
  assert.deepEqual(await resolver.resolve("necmettin-servis"), expected);
});

test("Servis uses the October 9 export scale and origin in both map and room editor", async () => {
  const source = JSON.parse(await readFile(path.join(mapsDirectory, "necmettin-servis", "source.floorplan.json"), "utf8"));
  const calibration = source.map.exportCalibration;
  assert.equal(source.project.updatedAt, "2026-10-09T11:28:47.028Z");
  assert.equal(calibration.centimetersPerPixel, 1.4171776872164112);
  const details = await new MapService(new FileMapRepository(mapsDirectory)).getMapDetails("necmettin-servis");
  assert.equal(details.calibration.pixelsPerMeter, 100 / calibration.centimetersPerPixel);
  assert.deepEqual(details.calibration.canvasOrigin, calibration.originPixel);
  assert.deepEqual(details.calibration.worldOrigin, source.map.worldOrigin);
  assert.equal(details.calibration.invertYAxis, true);
  assert.equal(details.calibration.rotationDegrees, 0);
  assert.ok(Math.abs(details.world.widthMeters - calibration.widthPx * calibration.centimetersPerPixel / 100) < 1e-8);
  assert.ok(Math.abs(details.world.heightMeters - calibration.heightPx * calibration.centimetersPerPixel / 100) < 1e-8);
  const png = await readFile(path.join(process.cwd(), "public", details.image.url));
  assert.equal(createHash("sha256").update(png).digest("hex"), "1e98c4840f0cd6c851649749d47372974a024a909b801b565312c745baad1f8d");
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), details.image.width);
  assert.equal(png.readUInt32BE(20), details.image.height);
  const response = await getMapRegionsRoute(new Request("http://localhost/api/maps/necmettin-servis/regions"), {
    params: Promise.resolve({ mapId: "necmettin-servis" }),
  });
  assert.equal(response.status, 200);
  const { config } = await response.json() as { config: RegionsConfig };
  assert.equal(config.map.image, details.image.url);
  const pixelToWorld = createAffineTransform(config.map.calibration.points);
  const transform = new CoordinateTransformService(details.calibration);
  for (const world of [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: source.bounds.maxX, y: source.bounds.maxY }]) {
    const pixel = transform.worldToCanvas(world);
    assert.ok(Math.abs(pixel.x - (calibration.originPixel.x + world.x * 100 / calibration.centimetersPerPixel)) < 1e-8);
    assert.ok(Math.abs(pixel.y - (calibration.originPixel.y - world.y * 100 / calibration.centimetersPerPixel)) < 1e-8);
    const editorWorld = pixelToWorld(pixel);
    assert.ok(Math.abs(editorWorld.x - world.x) < 1e-8);
    assert.ok(Math.abs(editorWorld.y - world.y) < 1e-8);
  }
});

test("API zone Neüyoğun resolves to intensive care while its display name stays unchanged", async () => {
  const repository = new FileMapRepository(mapsDirectory);
  const catalog = await repository.readCatalog();
  const intensiveCare = catalog.maps.find((entry) => entry.id === "necmettin-yogun-bakim")!;
  assert.equal(intensiveCare.displayName, "Yoğun Bakım");
  assert.equal(intensiveCare.floorLabel, "Yoğun Bakım");
  assert.equal(intensiveCare.unitName, "Yoğun Bakım");
  const position = parsePositionPayload({
    type: "position", tag_id: "ICU-1", x: 1, y: 2, timestamp: "2026-10-08T13:00:00Z",
    zone_id: "Neüyoğun", zone_name: "Neüyoğun",
  });
  const resolver = new ZoneMapResolver(repository);
  const expected = { mapId: intensiveCare.id, resolved: true };
  assert.deepEqual(await resolver.resolve(position.sourceZoneId ?? null), expected);
  assert.deepEqual(await resolver.resolve("NEÜYOĞUN"), expected);
  // The motor sends the ASCII id separately from its Turkish display name.
  const motorPosition = parsePositionPayload({
    type: "position", tag_id: "06F0623201E95CE8", x: 1, y: 2,
    timestamp: "2026-10-08T13:00:00Z", zone_id: "neuyogun", zone_name: "Neüyoğun",
  });
  assert.deepEqual(await resolver.resolve(motorPosition.sourceZoneId ?? null), expected);
});

for (const mapId of ["necmettin-servis", "necmettin-yogun-bakim"]) {
test(`${mapId} loads in the room editor with its own image and calibration`, async () => {
  const service = new MapService(new FileMapRepository(mapsDirectory));
  const details = await service.getMapDetails(mapId);
  const response = await getMapRegionsRoute(new Request(`http://localhost/api/maps/${mapId}/regions`), {
    params: Promise.resolve({ mapId }),
  });
  assert.equal(response.status, 200);
  const { config } = await response.json() as { config: RegionsConfig };
  assert.equal(config.map.mapId, details.id);
  assert.equal(config.map.image, details.image.url);
  assert.equal(config.map.widthPx, details.image.width);
  assert.equal(config.map.heightPx, details.image.height);
  const transform = createAffineTransform(config.map.calibration.points);
  const viewportTransform = new CoordinateTransformService(details.calibration);
  const world = transform(viewportTransform.worldToCanvas({ x: 10, y: 5 }));
  assert.ok(Math.abs(world.x - 10) < 1e-8);
  assert.ok(Math.abs(world.y - 5) < 1e-8);
  if (mapId === "necmettin-servis") assert.equal(config.regions.filter((region) => region.kind === "room").length, 18);
  else assert.equal(config.regions.filter((region) => region.kind === "room").length, 7);
});
}

test("intensive care uses the selected origin with Y along the long horizontal axis", async () => {
  const details = await new MapService(new FileMapRepository(mapsDirectory)).getMapDetails("necmettin-yogun-bakim");
  const transform = new CoordinateTransformService(details.calibration);
  const selectedPixel = {
    x: 719.75 - 3.56 * details.calibration.pixelsPerMeter,
    y: 3039.8 - 14.53 * details.calibration.pixelsPerMeter,
  };
  const origin = transform.canvasToWorld(selectedPixel);
  assert.ok(Math.abs(origin.x) < 1e-8);
  assert.ok(Math.abs(origin.y) < 1e-8);
  const positiveY = transform.worldToCanvas({ x: 0, y: 1 });
  const positiveX = transform.worldToCanvas({ x: 1, y: 0 });
  assert.ok(positiveY.x > selectedPixel.x);
  assert.ok(Math.abs(positiveY.y - selectedPixel.y) < 1e-8);
  assert.ok(positiveX.y > selectedPixel.y);
  assert.ok(Math.abs(positiveX.x - selectedPixel.x) < 1e-8);
  assert.ok(details.world.heightMeters > details.world.widthMeters);
});

test("checked-in map catalog and live map config are valid", async () => {
  const service = new MapService(new FileMapRepository(mapsDirectory));
  const catalog = await service.getCatalog();
  assert.equal(catalog.defaultMapId, "spor-koridor");
  assert.equal(catalog.liveTrackingMapId, "spor-koridor");
  assert.ok(catalog.maps.some((entry) => entry.id === "kat1-ortopedi" && entry.status === "active" && entry.liveTrackingEnabled));
  const sportsCorridor = catalog.maps.find((entry) => entry.id === "spor-koridor");
  assert.equal(sportsCorridor?.unitName, "spor");
  assert.deepEqual(sportsCorridor?.trackingZoneIds, ["zone-a", "uwb-floor-1", "spor-koridor", "spor-2"]);
  assert.ok(catalog.maps.some((entry) => entry.status === "planned" && entry.configPath === null));
  const details = await service.getMapDetails(catalog.liveTrackingMapId);
  assert.equal(details.image.url, "/maps/spor-koridor/floor-plan.png");
  assert.equal(details.calibration.pixelsPerMeter, 113.584734212);
  assert.deepEqual(details.calibration.canvasOrigin, { x: 812.16, y: 1735.14 });
});

test("multiple live maps are valid but duplicate active zone mappings are rejected", async () => {
  const catalog = await new FileMapRepository(mapsDirectory).readCatalog();
  assert.equal(catalog.maps.filter((entry) => entry.liveTrackingEnabled).length, 4);
  const duplicate = structuredClone(catalog) as unknown as { maps: Array<Record<string, unknown>> } & Record<string, unknown>;
  duplicate.maps[1].trackingZoneIds = ["zone-a"];
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gekon-map-zones-"));
  try {
    await writeFile(path.join(temporaryDirectory, "catalog.json"), JSON.stringify(duplicate), "utf8");
    await assert.rejects(() => new FileMapRepository(temporaryDirectory).readCatalog(), /birden fazla haritaya/);
  } finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
});

test("invalid catalogs are rejected before being served", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gekon-map-catalog-"));
  try {
    await writeFile(path.join(temporaryDirectory, "catalog.json"), JSON.stringify({
      version: 1,
      defaultMapId: "missing-map",
      liveTrackingMapId: "missing-map",
      maps: [],
    }), "utf8");
    await assert.rejects(() => new FileMapRepository(temporaryDirectory).readCatalog());
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("unknown, traversal and planned map requests have controlled errors", async () => {
  const service = new MapService(new FileMapRepository(mapsDirectory));
  await assert.rejects(
    () => service.getMapDetails("bilinmeyen-harita"),
    (error: unknown) => error instanceof MapRequestError && error.code === "MAP_NOT_FOUND" && error.status === 404,
  );
  await assert.rejects(
    () => service.getMapDetails("../catalog"),
    (error: unknown) => error instanceof MapRequestError && error.code === "INVALID_MAP_ID" && error.status === 400,
  );
  await assert.rejects(
    () => service.getMapDetails("kat1-ornek-birim"),
    (error: unknown) => error instanceof MapRequestError && error.code === "MAP_NOT_CONFIGURED" && error.status === 409,
  );
});

test("map endpoint maps unknown and traversal input to 404 and 400", async () => {
  const unknownResponse = await getMapRoute(new Request("http://localhost/api/maps/bilinmeyen"), {
    params: Promise.resolve({ mapId: "bilinmeyen" }),
  });
  assert.equal(unknownResponse.status, 404);
  const traversalResponse = await getMapRoute(new Request("http://localhost/api/maps/traversal"), {
    params: Promise.resolve({ mapId: "../catalog" }),
  });
  assert.equal(traversalResponse.status, 400);
});
