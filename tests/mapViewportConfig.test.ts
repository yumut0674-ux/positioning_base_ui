import assert from "node:assert/strict";
import test from "node:test";
import { constrainMapViewport, getFittedMapViewport, isAtFittedScale, MAP_FLOOR_PLAN } from "../src/features/map/config/mapConfig";

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

test("locks panning at the fitted scale and constrains a zoomed plan to the map panel", () => {
  const panel = { width: 1_200, height: 800 };
  const fitted = getFittedMapViewport(panel);
  assert.ok(fitted);
  assert.equal(isAtFittedScale(fitted, fitted), true);
  assert.equal(isAtFittedScale({ ...fitted, scale: fitted.scale + 0.01 }, fitted), false);

  const zoomed = { scale: fitted.scale * 2, x: 9_999, y: -9_999 };
  const constrained = constrainMapViewport(zoomed, panel);
  const planWidth = MAP_FLOOR_PLAN.canvasSize.width * constrained.scale;
  const planHeight = MAP_FLOOR_PLAN.canvasSize.height * constrained.scale;

  assert.equal(constrained.x, 0);
  assert.equal(constrained.y, panel.height - planHeight);
  assert.ok(constrained.x + planWidth >= panel.width);
  assert.ok(constrained.y <= 0);
});

test("centers axes that remain smaller than the panel while zoomed", () => {
  const panel = { width: 2_000, height: 300 };
  const constrained = constrainMapViewport({ scale: 0.4, x: -500, y: 500 }, panel);
  const planWidth = MAP_FLOOR_PLAN.canvasSize.width * constrained.scale;

  assert.equal(constrained.x, (panel.width - planWidth) / 2);
  assert.equal(constrained.y, 0);
});
