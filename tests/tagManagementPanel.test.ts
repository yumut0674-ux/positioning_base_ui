import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

test("tag management panel owns the live-map trail controls", () => {
  const source = readFileSync(path.join(process.cwd(), "app/tags/page.tsx"), "utf8");
  const livePanelSource = readFileSync(path.join(process.cwd(), "src/features/tracking/components/TagInformationPanel.tsx"), "utf8");

  assert.match(source, /<TagTrailSettingsCard \/>/);
  assert.match(source, /Tag hareket kuyruğu/);
  assert.match(source, /Tag hareket kuyruğunu aç veya kapat/);
  assert.match(source, /Kuyruk süresi/);
  assert.doesNotMatch(livePanelSource, /TagTrailSettingsCard|Hareket kuyruğu|Kuyruk süresi/);
});
