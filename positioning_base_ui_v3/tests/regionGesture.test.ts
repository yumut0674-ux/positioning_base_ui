import assert from "node:assert/strict";
import test from "node:test";
import { REGION_DRAG_THRESHOLD_PX, hasExceededDragThreshold } from "../src/features/regions/services/regionGesture";

test("region drawing accepts short taps and rejects dragged pointers", () => {
  assert.equal(REGION_DRAG_THRESHOLD_PX, 8);
  assert.equal(hasExceededDragThreshold({ x: 100, y: 100 }, { x: 105, y: 104 }), false);
  assert.equal(hasExceededDragThreshold({ x: 100, y: 100 }, { x: 108, y: 100 }), true);
  assert.equal(hasExceededDragThreshold({ x: 100, y: 100 }, { x: 94, y: 94 }), true);
});
