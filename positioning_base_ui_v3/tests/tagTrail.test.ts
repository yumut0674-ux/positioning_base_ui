import assert from "node:assert/strict";
import test from "node:test";
import { appendTagTrailPoint, pruneTagTrail } from "../src/features/tracking/services/tagTrail";
import {
  DEFAULT_TAG_TRAIL_SETTINGS,
  persistTagTrailSettings,
  readTagTrailSettings,
  resolveTagTrailSettings,
} from "../src/features/tracking/services/tagTrailSettings";
import { useIpsStore } from "../src/app/store/useIpsStore";

test("trail retains only the configured time window", () => {
  let points = appendTagTrailPoint([], { x: 0, y: 0 }, 1_000, 5_000);
  points = appendTagTrailPoint(points, { x: 1, y: 0 }, 4_000, 5_000);
  points = appendTagTrailPoint(points, { x: 2, y: 0 }, 7_000, 5_000);

  assert.deepEqual(pruneTagTrail(points, 7_000, 5_000).map((point) => point.x), [1, 2]);
  assert.deepEqual(pruneTagTrail(points, 7_000, 1_000).map((point) => point.x), [2]);
});

test("trail ignores jitter and breaks across jumps or region-centre positions", () => {
  let points = appendTagTrailPoint([], { x: 0, y: 0, source: "RAW" }, 1_000, 5_000);
  points = appendTagTrailPoint(points, { x: 0.01, y: 0, source: "RAW" }, 1_100, 5_000);
  assert.equal(points.length, 1);

  points = appendTagTrailPoint(points, { x: 1, y: 0, source: "RAW" }, 1_200, 5_000);
  points = appendTagTrailPoint(points, { x: 10, y: 0, source: "RAW" }, 1_300, 5_000);
  points = appendTagTrailPoint(points, { x: 12, y: 2, source: "REGION_CENTER" }, 1_400, 5_000);

  assert.deepEqual(points.map((point) => point.segment), [0, 0, 1, 2]);
});

test("non-routable room relocation starts a new trail segment at the destination", () => {
  let points = appendTagTrailPoint([], { x: -1.013164, y: 2.285254, source: "REGION_CENTER", relocationSequence: 0 }, 1_000, 5_000);
  points = appendTagTrailPoint(points, { x: 2.507731, y: -1.552673, source: "REGION_CENTER", relocationSequence: 1 }, 1_500, 5_000);
  assert.equal(points.length, 2);
  assert.notEqual(points[0].segment, points[1].segment);
});

test("trail settings validate and persist browser preferences", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };

  persistTagTrailSettings(storage, { enabled: false, durationMs: 3_000 });
  assert.deepEqual(readTagTrailSettings(storage), { enabled: false, durationMs: 3_000 });
  assert.deepEqual(resolveTagTrailSettings({ enabled: "yes", durationMs: 99_000 }), {
    enabled: DEFAULT_TAG_TRAIL_SETTINGS.enabled,
    durationMs: 15_000,
  });
});

test("tag panel trail actions update only the visual preference", () => {
  const original = useIpsStore.getState().tagTrailSettings;
  try {
    useIpsStore.getState().setTagTrailEnabled(false);
    useIpsStore.getState().setTagTrailDuration(2_400);
    assert.deepEqual(useIpsStore.getState().tagTrailSettings, { enabled: false, durationMs: 2_000 });
  } finally {
    useIpsStore.setState({ tagTrailSettings: original });
  }
});
