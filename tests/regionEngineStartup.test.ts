import assert from "node:assert/strict";
import test from "node:test";
import { register } from "../instrumentation";
import { GET, PUT } from "../app/api/region-engine/status/route";
import { regionEngineController } from "../src/server/regionEngine/controller";
import { ProcessedPositionServer } from "../src/server/regionEngine/ProcessedPositionServer";
import { areaTransitions } from "../src/server/regionEngine/areaTransitionRepository";

test("server startup enables room detection for live maps and manual disable remains effective", async (context) => {
  const start = context.mock.method(ProcessedPositionServer.prototype, "start", async () => undefined);
  context.mock.method(ProcessedPositionServer.prototype, "stop", async () => undefined);
  context.mock.method(areaTransitions, "restore", async () => []);
  context.mock.method(areaTransitions, "flush", async () => undefined);
  try {
    await register();
    const status = await GET().json();
    assert.equal(status.enabled, true);
    assert.equal(status.maps["necmettin-servis"].configLoaded, true);
    assert.equal(status.maps["necmettin-yogun-bakim"].configLoaded, true);
    assert.equal(status.maps["kat1-ornek-birim"], undefined);

    await register();
    assert.equal(start.mock.callCount(), 1);

    const disabled = await PUT(new Request("http://localhost/api/region-engine/status", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    }));
    assert.equal(disabled.status, 200);
    assert.equal((await GET().json()).enabled, false);
    assert.equal(start.mock.callCount(), 1);
  } finally {
    await regionEngineController.dispose();
  }
});
