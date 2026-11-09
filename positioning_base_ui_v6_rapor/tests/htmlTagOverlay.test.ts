import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MAP_CALIBRATION } from "../src/features/map/config/mapConfig";
import { CoordinateTransformService } from "../src/features/map/services/CoordinateTransformService";
import {
  htmlTagPositionTransform,
  htmlTagViewportTransform,
  renderHtmlTagPosition,
} from "../src/features/map/services/htmlTagOverlay";
import { PositionAnimationController } from "../src/features/tracking/services/PositionAnimationController";
import { DEFAULT_POSITION_ANIMATION_CONFIG } from "../src/features/tracking/config/positionAnimationConfig";

test("live-map tag label uses the display name instead of the hardware id", () => {
  const source = readFileSync(path.join(process.cwd(), "src/features/map/components/HtmlTagNode.tsx"), "utf8");
  assert.match(source, /className=\{styles\.label\}>\{tag\.name\}/);
  assert.doesNotMatch(source, /className=\{styles\.label\}>\{tag\.id\}/);
  assert.doesNotMatch(source, /· Belirsiz|· Tahmin/);
});

test("HTML tag overlay uses the same translation and scale as the Konva viewport", () => {
  assert.equal(
    htmlTagViewportTransform({ x: -125.5, y: 42, scale: 1.75 }),
    "translate3d(-125.5px, 42px, 0) scale(1.75)",
  );
});

test("world coordinates are written as a compositor-friendly tag transform", () => {
  const coordinateTransform = new CoordinateTransformService(MAP_CALIBRATION);
  const target = { style: { transform: "" } };

  renderHtmlTagPosition(target, coordinateTransform, 2, 3);

  assert.equal(target.style.transform, htmlTagPositionTransform(coordinateTransform.worldToCanvas({ x: 2, y: 3 })));
  assert.match(target.style.transform, /^translate3d\(315\.645094/);
});

test("detached HTML renderers are not updated by later positions", () => {
  const coordinateTransform = new CoordinateTransformService(MAP_CALIBRATION);
  const target = { style: { transform: "" } };
  const animation = new PositionAnimationController({
    ...DEFAULT_POSITION_ANIMATION_CONFIG,
    enabled: false,
  });
  const detach = animation.attach("TAG-HTML", {
    render: (x, y) => renderHtmlTagPosition(target, coordinateTransform, x, y),
  });

  animation.ingest("TAG-HTML", { x: 1, y: 1, timestamp: 1_000, receivedAt: 1_000 });
  const firstPosition = target.style.transform;
  assert.equal(firstPosition, htmlTagPositionTransform(coordinateTransform.worldToCanvas({ x: 1, y: 1 })));

  detach();
  animation.ingest("TAG-HTML", { x: 5, y: 5, timestamp: 2_000, receivedAt: 2_000 });
  assert.equal(target.style.transform, firstPosition);
});
