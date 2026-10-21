import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileSystemSettings } from "../src/server/settings/systemSettings";
import { createSettingsHandlers } from "../src/server/settings/settingsHttp";

test("settings API supplies defaults, persists seconds and applies changes only after a successful save", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "uwb-settings-"));
  const file = path.join(directory, "settings.json");
  let applied = 0;
  const handlers = createSettingsHandlers(new FileSystemSettings(file), async () => { applied++; });
  const request = (value: unknown) => new Request("http://localhost/api/settings", { method: "PUT", body: JSON.stringify(value) });
  try {
    assert.equal((await (await handlers.get()).json()).settings.tracking.noDataHideAfterMs, 60_000);
    for (const value of [0, -1, 1001, 86_401_000, "60000", null]) {
      assert.equal((await handlers.put(request({ version: 1, tracking: { noDataHideAfterMs: value } }))).status, 400);
    }
    assert.equal(applied, 0);
    const settings = { version: 1, tracking: { noDataHideAfterMs: 120_000 }, reports: { routeHistoryMinDurationMs: 60_000 } };
    assert.equal((await handlers.put(request(settings))).status, 200);
    assert.equal(applied, 1);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), settings);
    assert.deepEqual(await new FileSystemSettings(file).read(), settings);
    await writeFile(file, "{broken");
    assert.equal((await handlers.get()).status, 503);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("settings hot reload replaces an instance using the previous module's schema", async () => {
  const host = process as NodeJS.Process & { __uwbSystemSettings?: FileSystemSettings };
  const original = host.__uwbSystemSettings;
  const previous = new FileSystemSettings();
  host.__uwbSystemSettings = previous;
  try {
    const moduleUrl = new URL("../src/server/settings/systemSettings.ts", import.meta.url);
    moduleUrl.searchParams.set("reload", "report-settings-regression");
    const reloaded = await import(moduleUrl.href);
    assert.notEqual(reloaded.systemSettings, previous);
    assert.ok(reloaded.systemSettings instanceof reloaded.FileSystemSettings);
    assert.equal(host.__uwbSystemSettings, reloaded.systemSettings);
  } finally { host.__uwbSystemSettings = original; }
});

test("report threshold defaults on legacy settings and persists independently of tracking", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "uwb-report-settings-"));
  const file = path.join(directory, "settings.json");
  const legacy = { version: 1, tracking: { noDataHideAfterMs: 120_000 } };
  const handlers = createSettingsHandlers(new FileSystemSettings(file));
  const request = (value: unknown) => new Request("http://localhost/api/settings", { method: "PUT", body: JSON.stringify(value) });
  try {
    await writeFile(file, JSON.stringify(legacy));
    const initial = await (await handlers.get()).json();
    assert.equal(initial.settings.reports.routeHistoryMinDurationMs, 60_000);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), legacy);
    for (const value of [-1, 1001, 86_401_000, "60000", null]) {
      const response = await handlers.put(request({ ...legacy, reports: { routeHistoryMinDurationMs: value } }));
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /Rapora dahil edilecek/);
    }
    for (const threshold of [0, 60_000, 120_000]) {
      const settings = { ...legacy, reports: { routeHistoryMinDurationMs: threshold } };
      assert.equal((await handlers.put(request(settings))).status, 200);
      assert.deepEqual(await new FileSystemSettings(file).read(), settings);
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), settings);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
