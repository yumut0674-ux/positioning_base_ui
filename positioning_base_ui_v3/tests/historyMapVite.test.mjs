import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import vinext from "vinext";

test("history image endpoint loads and renders through the Vinext/Vite development module runner", { timeout: 60_000 }, async () => {
  const cacheParent = path.resolve(process.cwd(), ".data");
  await mkdir(cacheParent, { recursive: true });
  const cacheDir = await mkdtemp(path.join(cacheParent, "history-map-vite-"));
  let server;
  try {
    server = await createServer({
      configFile: false, cacheDir,
      plugins: [vinext()],
      resolve: { alias: { "@": process.cwd() } },
      server: { middlewareMode: true, hmr: false },
      logLevel: "error",
    });
    // Direct Node/tsx imports do not exercise Vite's CommonJS-to-ESM transforms.
    const route = await server.ssrLoadModule("/app/api/location/history-map/selection/route.ts");
    const response = await route.POST(new Request("http://localhost/api/location/history-map/selection", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapId: "necmettin-servis", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], showRoute: true }),
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "image/png");
    const image = Buffer.from(await response.arrayBuffer());
    assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(image.readUInt32BE(16), 3840);
    assert.equal(image.readUInt32BE(20), 2160);
  } finally {
    await server?.close();
    assert.equal(path.dirname(path.resolve(cacheDir)), cacheParent);
    await rm(cacheDir, { recursive: true, force: true });
  }
});
