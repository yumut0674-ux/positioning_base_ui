import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { ProcessedPositionServer } from "../src/server/regionEngine/ProcessedPositionServer";

test("processed server publishes backward-compatible position events over SSE", async () => {
  const output = new ProcessedPositionServer(0, "*");
  await output.start();
  assert.equal(output.boundHost, "127.0.0.1");
  const abort = new AbortController();
  try {
    const response = await fetch(`http://127.0.0.1:${output.boundPort}/api/tracking/ingest`, { signal: abort.signal });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    const reader = response.body?.getReader();
    assert.ok(reader);
    const decoder = new TextDecoder();
    assert.match(decoder.decode((await reader.read()).value), /retry: 3000/);
    output.publish({
      tagCode: "vehicle-1", x: 5, y: 5, timestamp: "2026-07-21T12:00:00.000Z",
      positionSource: "REGION_CENTER",
      regionInference: { enabled: true, state: "IN_REGION", regionId: "room-a", confidence: 1 },
      rawPosition: { tagCode: "vehicle-1", x: 2, y: 3, timestamp: "2026-07-21T12:00:00.000Z" },
      lastRawDataTimestamp: "2026-07-21T12:00:00.000Z",
    });
    const event = decoder.decode((await reader.read()).value);
    assert.match(event, /event: position/);
    assert.match(event, /"tagCode":"vehicle-1"/);
    assert.match(event, /"positionSource":"REGION_CENTER"/);
  } finally {
    abort.abort();
    await output.stop();
  }
});

test("processed port reports a clear error when the configured port is occupied", async () => {
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const address = blocker.address();
  assert.ok(address && typeof address === "object");
  const output = new ProcessedPositionServer(address.port, "*");
  try {
    await assert.rejects(output.start(), new RegExp(`REGION_POSITION_PORT ${address.port} kullanımda`));
  } finally {
    await output.stop();
    await new Promise<void>((resolve, reject) => blocker.close((error) => error ? reject(error) : resolve()));
  }
});
