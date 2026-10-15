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
    const settings = { version: 1, tracking: { noDataHideAfterMs: 120_000 } };
    assert.equal((await handlers.put(request(settings))).status, 200);
    assert.equal(applied, 1);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), settings);
    assert.deepEqual(await new FileSystemSettings(file).read(), settings);
    await writeFile(file, "{broken");
    assert.equal((await handlers.get()).status, 503);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
