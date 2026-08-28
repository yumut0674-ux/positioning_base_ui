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
  assert.equal(catalog.defaultMapId, "kat1-ortopedi");
  assert.equal(catalog.liveTrackingMapId, "kat1-ortopedi");
  assert.ok(catalog.maps.some((entry) => entry.status === "planned" && entry.configPath === null));
  const details = await service.getMapDetails(catalog.liveTrackingMapId);
  assert.equal(details.image.url, "/maps/kat1-ortopedi/floor-plan.png");
  assert.equal(details.calibration.pixelsPerMeter, 30);
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
