import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { GET as getProcessedStream } from "../app/api/tracking/processed/route";
import { createHealthResponse } from "../app/api/health/route";
import { processedStreamUrl } from "../src/features/regions/services/regionEngineApi";

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      assert.ok(address && typeof address === "object");
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });
}

test("processed browser stream URL is same-origin and contains no private service port", () => {
  assert.equal(processedStreamUrl(), "/api/tracking/processed");
  assert.doesNotMatch(processedStreamUrl(), /3001|^https?:\/\//);
});

test("processed proxy streams SSE and cancels upstream when the browser stream closes", async () => {
  let markUpstreamClosed: (() => void) | undefined;
  const upstreamClosed = new Promise<void>((resolve) => { markUpstreamClosed = resolve; });
  const upstream = createServer((request, response) => {
    assert.equal(request.url, "/api/tracking/stream");
    assert.equal(request.headers.accept, "text/event-stream");
    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
    response.write("retry: 3000\n\n");
    response.once("close", () => markUpstreamClosed?.());
  });
  const port = await listen(upstream);
  const previousPort = process.env.REGION_POSITION_PORT;
  process.env.REGION_POSITION_PORT = String(port);

  try {
    const response = await getProcessedStream(new Request("http://localhost/api/tracking/processed"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
    assert.equal(response.headers.get("x-accel-buffering"), "no");

    const reader = response.body?.getReader();
    assert.ok(reader);
    const firstChunk = await Promise.race([reader.read(), timeout(2_000)]);
    assert.match(new TextDecoder().decode(firstChunk.value), /retry: 3000/);
    await reader.cancel();
    await Promise.race([upstreamClosed, timeout(2_000)]);
  } finally {
    if (previousPort === undefined) delete process.env.REGION_POSITION_PORT;
    else process.env.REGION_POSITION_PORT = previousPort;
    await close(upstream);
  }
});

test("processed proxy returns a generic 503 when its loopback upstream is unavailable", async () => {
  const unusedPortServer = createServer();
  const unusedPort = await listen(unusedPortServer);
  await close(unusedPortServer);
  const previousPort = process.env.REGION_POSITION_PORT;
  process.env.REGION_POSITION_PORT = String(unusedPort);

  try {
    const response = await getProcessedStream(new Request("http://localhost/api/tracking/processed"));
    assert.equal(response.status, 503);
    const body = JSON.stringify(await response.json());
    assert.match(body, /unavailable/i);
    assert.doesNotMatch(body, /127\.0\.0\.1|3001|ECONNREFUSED|stack/i);
  } finally {
    if (previousPort === undefined) delete process.env.REGION_POSITION_PORT;
    else process.env.REGION_POSITION_PORT = previousPort;
  }
});

const healthyEngine = {
  enabled: false,
  rawPort: 3000,
  processedPort: 3001,
  activeVehicleCount: 0,
  vehiclesInRegions: 0,
  configLoaded: true,
};

test("an unconfigured optional assistant does not make an otherwise healthy response fail", async () => {
  const response = await createHealthResponse({
    checkDatabase: async () => ({ ok: true, status: "connected" }),
    checkAssistant: async () => ({ ok: false, status: "not_configured" }),
    trackingStatus: () => ({ ok: true, status: "available" }),
    engineStatus: () => healthyEngine,
    now: () => new Date("2026-08-03T00:00:00.000Z"),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { ok: boolean; assistantService: { status: string } };
  assert.equal(body.ok, true);
  assert.equal(body.assistantService.status, "not_configured");
});

test("health response strips sensitive internal failure details", async () => {
  const response = await createHealthResponse({
    checkDatabase: async () => ({
      ok: false,
      status: "unavailable",
      error: "password secret at 127.0.0.1:5432",
      stack: "internal stack",
      host: "127.0.0.1",
    }),
    checkAssistant: async () => ({
      ok: false,
      status: "unavailable",
      message: "http://127.0.0.1:8000 failed",
      url: "http://127.0.0.1:8000",
    }),
    trackingStatus: () => ({ ok: true, status: "available" }),
    engineStatus: () => healthyEngine,
  });
  assert.equal(response.status, 503);
  const serialized = JSON.stringify(await response.json());
  assert.doesNotMatch(serialized, /secret|127\.0\.0\.1|5432|8000|internal stack/i);
});
