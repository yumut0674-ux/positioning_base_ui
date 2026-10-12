import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "../app/api/tracking/ingest/route";
import { trackingBuffer, type TrackingPosition } from "../src/server/trackingBuffer";

const EXAMPLE_PAYLOAD = {
  type: "position",
  tag_id: "A1B2C3D400000001",
  x: 1.25,
  y: 0.8,
  zone_id: "servis",
  zone_name: " Servis ",
  timestamp: "2026-07-21T14:30:15.123+03:00",
} as const;

function jsonRequest(payload: unknown): Request {
  return new Request("http://localhost/api/tracking/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

test("kaynak heartbeat'i ayrı token ve bilinen zone gerektirir", async () => {
  const oldToken = process.env.TRACKING_HEALTH_TOKEN;
  process.env.TRACKING_HEALTH_TOKEN = "test-health-secret";
  const body = { type: "source_health", zone_id: "servis", status: "healthy", timestamp: new Date().toISOString() };
  try {
    assert.equal((await POST(jsonRequest(body))).status, 401);
    const authorized = (payload: unknown) => new Request("http://localhost/api/tracking/ingest", {
      method: "POST", headers: { "content-type": "application/json", "x-tracking-health-token": "test-health-secret" }, body: JSON.stringify(payload),
    });
    const response = await POST(authorized(body));
    assert.equal(response.status, 202);
    assert.equal((await response.json() as { sourceHealth: string }).sourceHealth, "healthy");
    assert.equal((await POST(authorized({ ...body, zone_id: "not-configured" }))).status, 400);
  } finally {
    if (oldToken === undefined) delete process.env.TRACKING_HEALTH_TOKEN;
    else process.env.TRACKING_HEALTH_TOKEN = oldToken;
  }
});

test("örnek position payload'ı 202 ile kabul edilir ve gönderilen zaman korunur", async () => {
  const originalIngest = trackingBuffer.ingest.bind(trackingBuffer);
  let captured: TrackingPosition | undefined;
  trackingBuffer.ingest = async (position) => {
    captured = position;
    return true;
  };

  try {
    const response = await POST(jsonRequest(EXAMPLE_PAYLOAD));
    assert.equal(response.status, 202);
    assert.deepEqual(captured, {
      tagCode: "A1B2C3D400000001",
      x: 1.25,
      y: 0.8,
      timestamp: "2026-07-21T14:30:15.123+03:00",
      sourceZoneId: "servis",
      sourceZoneName: "Servis",
      mapId: "necmettin-servis",
    });
  } finally {
    trackingBuffer.ingest = originalIngest;
  }
});

test("null ve bilinmeyen zone kabul edilir fakat haritaya çözülmez", async () => {
  const originalIngest = trackingBuffer.ingest.bind(trackingBuffer);
  const captured: TrackingPosition[] = [];
  trackingBuffer.ingest = async (position) => { captured.push(position); return false; };
  try {
    for (const zone of [null, "not-configured", "zone-a", "zone-b"]) {
      const response = await POST(jsonRequest({ ...EXAMPLE_PAYLOAD, zone_id: zone, zone_name: null }));
      assert.equal(response.status, 202);
      assert.equal((await response.json() as { mapId: unknown }).mapId, null);
    }
    assert.deepEqual(captured.map((position) => position.mapId), [null, null, null, null]);
  } finally { trackingBuffer.ingest = originalIngest; }
});

test("zone alanlarında tip ve uzunluk doğrulaması uygulanır", async () => {
  for (const payload of [{ ...EXAMPLE_PAYLOAD, zone_id: 7 }, { ...EXAMPLE_PAYLOAD, zone_name: "x".repeat(161) }]) {
    assert.equal((await POST(jsonRequest(payload))).status, 400);
  }
});

test("negatif koordinatlar geçerlidir", async () => {
  const originalIngest = trackingBuffer.ingest.bind(trackingBuffer);
  trackingBuffer.ingest = async () => true;
  try {
    const response = await POST(jsonRequest({ ...EXAMPLE_PAYLOAD, x: -1.25, y: -0.8 }));
    assert.equal(response.status, 202);
  } finally {
    trackingBuffer.ingest = originalIngest;
  }
});

test("ingest POST aynı route üzerindeki SSE akışına position eventi yayınlar", async () => {
  const abortController = new AbortController();
  const streamResponse = GET(new Request("http://localhost/api/tracking/ingest", {
    signal: abortController.signal,
  }));
  const reader = streamResponse.body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();
  const initial = await reader.read();
  assert.match(decoder.decode(initial.value), /retry: 3000/);

  const originalIngest = trackingBuffer.ingest.bind(trackingBuffer);
  trackingBuffer.ingest = async (position) => {
    trackingBuffer.emit("position", position);
    return true;
  };

  try {
    const response = await POST(jsonRequest(EXAMPLE_PAYLOAD));
    assert.equal(response.status, 202);
    const event = decoder.decode((await reader.read()).value);
    assert.match(event, /event: position/);
    assert.match(event, /"tagCode":"A1B2C3D400000001"/);
    assert.match(event, /"timestamp":"2026-07-21T14:30:15.123\+03:00"/);
  } finally {
    trackingBuffer.ingest = originalIngest;
    abortController.abort();
  }
});

test("geçersiz sözleşme payload'ları açıklayıcı 400 döndürür", async (context) => {
  const cases = [
    ["yanlış type", { ...EXAMPLE_PAYLOAD, type: "location" }],
    ["eksik tag_id", Object.fromEntries(Object.entries(EXAMPLE_PAYLOAD).filter(([field]) => field !== "tag_id"))],
    ["string x", { ...EXAMPLE_PAYLOAD, x: "1.25" }],
    ["string y", { ...EXAMPLE_PAYLOAD, y: "0.8" }],
    ["geçersiz timestamp", { ...EXAMPLE_PAYLOAD, timestamp: "2026-02-30T14:30:15+03:00" }],
    ["fazladan alan", { ...EXAMPLE_PAYLOAD, battery: 90 }],
  ] as const;

  for (const [name, payload] of cases) {
    await context.test(name, async () => {
      const response = await POST(jsonRequest(payload));
      assert.equal(response.status, 400);
      const body = await response.json() as { error?: unknown };
      assert.ok(typeof body.error === "string" && body.error.length > 0);
    });
  }
});

test("bozuk JSON 400 döndürür", async () => {
  const response = await POST(new Request("http://localhost/api/tracking/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  }));
  assert.equal(response.status, 400);
  assert.equal(typeof (await response.json() as { error?: unknown }).error, "string");
});
