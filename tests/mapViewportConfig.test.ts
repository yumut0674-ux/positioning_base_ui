import assert from "node:assert/strict";
import test from "node:test";
import { getFittedMapViewport, MAP_FLOOR_PLAN } from "../src/features/map/config/mapConfig";

test("fits and centers the complete floor plan in a desktop map panel", () => {
  const panel = { width: 1_200, height: 800 };
  const viewport = getFittedMapViewport(panel);

  assert.ok(viewport);
  const planWidth = MAP_FLOOR_PLAN.canvasSize.width * viewport.scale;
  const planHeight = MAP_FLOOR_PLAN.canvasSize.height * viewport.scale;
  assert.ok(viewport.x > 0);
  assert.ok(viewport.y > 0);
  assert.ok(viewport.x + planWidth < panel.width);
  assert.ok(viewport.y + planHeight < panel.height);
  assert.equal(viewport.x, (panel.width - planWidth) / 2);
  assert.equal(viewport.y, (panel.height - planHeight) / 2);
});

test("keeps the plan contained on narrow panels and ignores unmeasured panels", () => {
  const panel = { width: 220, height: 180 };
  const viewport = getFittedMapViewport(panel);

  assert.ok(viewport);
  assert.ok(viewport.x >= 0);
  assert.ok(viewport.y >= 0);
  assert.ok(viewport.x + MAP_FLOOR_PLAN.canvasSize.width * viewport.scale <= panel.width);
  assert.ok(viewport.y + MAP_FLOOR_PLAN.canvasSize.height * viewport.scale <= panel.height);
  assert.equal(getFittedMapViewport({ width: 0, height: 500 }), null);
  assert.equal(getFittedMapViewport({ width: 500, height: 0 }), null);
});
