import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { DEFAULT_REGIONS_CONFIG } from "../src/features/regions/config/defaultRegionsConfig";
import { createInverseAffineTransform } from "../src/features/regions/services/affineTransform";
import { createRawTagMarkers } from "../src/features/regions/services/rawTagPresentation";
import type { TrackedTag } from "../src/features/tracking/types/tracking.types";

const NOW = 20_000;
const TIMEOUT = 10_000;
const identity = ({ x, y }: { x: number; y: number }) => ({ x, y });

function rawTag(overrides: Partial<TrackedTag> = {}): TrackedTag {
  return {
    id: "TAG-RAW",
    name: "Raw tag",
    color: "#fff",
    status: "active",
    timestamp: 19_800,
    x: 12.342,
    y: 8.115,
    ...overrides,
  };
}

test("raw marker positions come only from observedTags and ignore processed display state", () => {
  const observedTags = { "TAG-RAW": rawTag() };
  const processedTags = { "TAG-RAW": rawTag({ x: 99, y: 88 }) };
  const mapTagDisplays = { "TAG-RAW": { visible: false } };

  const markers = createRawTagMarkers(observedTags, identity, NOW, TIMEOUT);

  assert.deepEqual(markers[0].world, { x: 12.342, y: 8.115 });
  assert.notDeepEqual(markers[0].world, { x: processedTags["TAG-RAW"].x, y: processedTags["TAG-RAW"].y });
  assert.equal(mapTagDisplays["TAG-RAW"].visible, false);
  assert.equal(markers.length, 1);
});

test("raw world position is converted with the existing inverse affine transform", () => {
  const inverseTransform = createInverseAffineTransform(DEFAULT_REGIONS_CONFIG.map.calibration.points);
  const world = DEFAULT_REGIONS_CONFIG.map.calibration.points[1].world;
  const expectedPixel = DEFAULT_REGIONS_CONFIG.map.calibration.points[1].pixel;
  const markers = createRawTagMarkers({ calibrated: rawTag({ x: world.x, y: world.y }) }, inverseTransform, NOW, TIMEOUT);

  assert.ok(Math.abs(markers[0].pixel.x - expectedPixel.x) < 0.001);
  assert.ok(Math.abs(markers[0].pixel.y - expectedPixel.y) < 0.001);
});

test("engine state cannot alter a raw marker coordinate", () => {
  const observedTags = { "TAG-RAW": rawTag() };
  const whenEngineOff = createRawTagMarkers(observedTags, identity, NOW, TIMEOUT);
  const whenEngineOn = createRawTagMarkers(observedTags, identity, NOW, TIMEOUT);
  assert.deepEqual(whenEngineOn, whenEngineOff);
});

test("stale raw tags remain visible and are marked stale", () => {
  const markers = createRawTagMarkers(
    { stale: rawTag({ timestamp: NOW - TIMEOUT - 1 }) },
    identity,
    NOW,
    TIMEOUT,
  );
  assert.equal(markers.length, 1);
  assert.equal(markers[0].stale, true);
});

test("non-finite raw or transformed coordinates are omitted", () => {
  const markers = createRawTagMarkers({
    nan: rawTag({ x: Number.NaN }),
    infinity: rawTag({ y: Number.POSITIVE_INFINITY }),
    transformed: rawTag({ id: "transformed" }),
  }, ({ x, y }) => x === 12.342 ? { x: Number.NaN, y } : { x, y }, NOW, TIMEOUT);
  assert.deepEqual(markers, []);
});

test("region panel keeps the raw view opt-in and the layer non-interactive", () => {
  const panelSource = readFileSync(path.join(process.cwd(), "src/features/regions/components/RegionManagementPanel.tsx"), "utf8");
  const layerSource = readFileSync(path.join(process.cwd(), "src/features/regions/components/RawTagLayer.tsx"), "utf8");

  assert.match(panelSource, /const \[showRawTagPositions, setShowRawTagPositions\] = useState\(false\);/);
  assert.match(panelSource, /useIpsStore\(\(state\) => state\.observedTags\)/);
  assert.match(panelSource, /showRawTagPositions && <RawTagLayer/);
  assert.match(panelSource, /setShowRawTagPositions\(\(current\) => !current\)/);
  assert.match(panelSource, /Ham tag verisi bekleniyor…/);
  assert.doesNotMatch(panelSource, /createRawTagMarkers\(tags\b/);
  assert.match(layerSource, /<Layer listening=\{false\}>/);
  assert.match(layerSource, /<Group[^>]*listening=\{false\}/);
});
