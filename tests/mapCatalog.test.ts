import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileMapRepository } from "../src/server/maps/mapRepository";
import { MapRequestError, MapService } from "../src/server/maps/mapService";
import { GET as getMapRoute } from "../app/api/maps/[mapId]/route";

const mapsDirectory = path.join(process.cwd(), "config", "maps");

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
  assert.equal(catalog.maps.filter((entry) => entry.liveTrackingEnabled).length, 2);
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
