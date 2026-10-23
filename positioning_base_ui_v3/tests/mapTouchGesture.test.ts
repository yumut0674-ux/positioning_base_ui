import assert from "node:assert/strict";
import test from "node:test";
import { getFittedMapViewport, MAP_VIEWPORT_LIMITS } from "../src/features/map/config/mapConfig";
import { createMapTouchGesture, getMapTouchViewport, type MapTouchPoint } from "../src/features/map/services/mapTouchGesture";

const panel = { width: 390, height: 520 };
const map = { width: 3840, height: 2160 };
const viewport = { x: -500, y: -100, scale: 0.4 };
const touch = (id: number, x: number, y: number): MapTouchPoint => ({ id, x, y });
const closeTo = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);

test("a mobile pinch can zoom in from the fitted scale below the normal zoom floor", () => {
  const fitted = getFittedMapViewport(panel, map)!;
  assert.ok(fitted.scale < MAP_VIEWPORT_LIMITS.minZoom);
  const gesture = createMapTouchGesture([touch(1, 145, 260), touch(2, 245, 260)], fitted);
  const next = getMapTouchViewport(gesture, [touch(1, 95, 260), touch(2, 295, 260)], fitted, panel, map);
  closeTo(next.scale, fitted.scale * 2);
});

test("pinching preserves the map point under the moving center of both fingers", () => {
  const gesture = createMapTouchGesture([touch(1, 100, 240), touch(2, 220, 240)], viewport);
  const next = getMapTouchViewport(gesture, [touch(1, 80, 260), touch(2, 240, 260)], viewport, panel, map);
  closeTo(next.scale, viewport.scale * 160 / 120);
  closeTo((160 - next.x) / next.scale, (160 - viewport.x) / viewport.scale);
  closeTo((260 - next.y) / next.scale, (240 - viewport.y) / viewport.scale);
});

test("two fingers moving together pan the map without changing the scale", () => {
  const gesture = createMapTouchGesture([touch(1, 100, 240), touch(2, 220, 240)], viewport);
  const next = getMapTouchViewport(gesture, [touch(1, 120, 270), touch(2, 240, 270)], viewport, panel, map);
  assert.deepEqual(next, { ...viewport, x: viewport.x + 20, y: viewport.y + 30 });
});

test("one finger pans a zoomed map and respects the map edges", () => {
  const gesture = createMapTouchGesture([touch(1, 100, 240)], viewport);
  const next = getMapTouchViewport(gesture, [touch(1, 130, 260)], viewport, panel, map);
  assert.deepEqual(next, { ...viewport, x: viewport.x + 30, y: viewport.y + 20 });
  const edge = getMapTouchViewport(gesture, [touch(1, -9000, 9000)], viewport, panel, map);
  assert.equal(edge.x, panel.width - map.width * viewport.scale);
  assert.equal(edge.y, 0);
});

test("one finger cannot move the fully fitted map", () => {
  const fitted = getFittedMapViewport(panel, map)!;
  const gesture = createMapTouchGesture([touch(1, 100, 240)], fitted);
  assert.deepEqual(getMapTouchViewport(gesture, [touch(1, 140, 300)], fitted, panel, map), fitted);
});

test("switching between pan and pinch keeps the current viewport and resumes with the remaining finger", () => {
  const pan = createMapTouchGesture([touch(1, 100, 240)], viewport);
  const panned = getMapTouchViewport(pan, [touch(1, 130, 260)], viewport, panel, map);
  const twoTouches = [touch(1, 130, 260), touch(2, 250, 260)];
  assert.deepEqual(getMapTouchViewport(pan, twoTouches, panned, panel, map), panned);
  const pinch = createMapTouchGesture(twoTouches, panned);
  const pinched = getMapTouchViewport(pinch, [touch(1, 110, 260), touch(2, 270, 260)], panned, panel, map);
  const remaining = [touch(2, 270, 260)];
  assert.deepEqual(getMapTouchViewport(pinch, remaining, pinched, panel, map), pinched);
  const resumedPan = createMapTouchGesture(remaining, pinched);
  const next = getMapTouchViewport(resumedPan, [touch(2, 280, 280)], pinched, panel, map);
  assert.deepEqual(next, { ...pinched, x: pinched.x + 10, y: pinched.y + 20 });
});

test("zooming out stops at the fitted map and reverses immediately in the same gesture", () => {
  const gesture = createMapTouchGesture([touch(1, 100, 240), touch(2, 300, 240)], viewport);
  const contractedTouches = [touch(1, 195, 240), touch(2, 205, 240)];
  const fitted = getMapTouchViewport(gesture, contractedTouches, viewport, panel, map);
  assert.deepEqual(fitted, getFittedMapViewport(panel, map));
  const rebased = createMapTouchGesture(contractedTouches, fitted);
  const next = getMapTouchViewport(rebased, [touch(1, 190, 240), touch(2, 210, 240)], fitted, panel, map);
  closeTo(next.scale, fitted.scale * 2);
});

test("reversing a pinch at maximum zoom responds without lifting the fingers", () => {
  const gesture = createMapTouchGesture([touch(1, 100, 240), touch(2, 200, 240)], viewport);
  const expandedTouches = [touch(1, 50, 240), touch(2, 950, 240)];
  const maximum = getMapTouchViewport(gesture, expandedTouches, viewport, panel, map);
  assert.equal(maximum.scale, MAP_VIEWPORT_LIMITS.maxZoom);
  const rebased = createMapTouchGesture(expandedTouches, maximum);
  const next = getMapTouchViewport(rebased, [touch(1, 95, 240), touch(2, 905, 240)], maximum, panel, map);
  closeTo(next.scale, maximum.scale * 0.9);
});

test("finger ordering is irrelevant and replacing a finger rebases instead of jumping", () => {
  const gesture = createMapTouchGesture([touch(1, 100, 240), touch(2, 220, 240)], viewport);
  assert.deepEqual(getMapTouchViewport(gesture, [touch(2, 220, 240), touch(1, 100, 240)], viewport, panel, map), viewport);
  assert.deepEqual(getMapTouchViewport(gesture, [touch(1, 100, 240), touch(3, 300, 240)], viewport, panel, map), viewport);
});

test("cancelled gestures, extra fingers, coincident fingers and unmeasured panels do not change the viewport", () => {
  const touches = [touch(1, 100, 240), touch(2, 220, 240)];
  const gesture = createMapTouchGesture(touches, viewport);
  assert.equal(createMapTouchGesture([], viewport), null);
  assert.equal(createMapTouchGesture([...touches, touch(3, 300, 240)], viewport), null);
  assert.deepEqual(getMapTouchViewport(null, touches, viewport, panel, map), viewport);
  assert.deepEqual(getMapTouchViewport(gesture, touches, viewport, { width: 0, height: 0 }, map), viewport);
  assert.deepEqual(getMapTouchViewport(gesture, [touch(1, 100, 240), touch(2, 100, 240)], viewport, panel, map), viewport);
  const coincident = createMapTouchGesture([touch(1, 100, 240), touch(2, 100, 240)], viewport);
  assert.deepEqual(getMapTouchViewport(coincident, touches, viewport, panel, map), viewport);
});
