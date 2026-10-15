import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST, parsePositionPayload } from "../app/api/tracking/ingest/route";
import { trackingBuffer, type TrackingPosition } from "../src/server/trackingBuffer";
import { zoneMapResolver } from "../src/server/maps/zoneMapResolver";
import { mapTrackingFilterSettings } from "../src/server/trackingFilterSettings";

const EXAMPLE_PAYLOAD = {
  type: "position",
  tag_id: "A1B2C3D400000001",
  x: 1.25,
  y: 0.8,
  pdop: 1.83,
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

test("örnek position payload'ı boş 204 ile kabul edilir; konum, PDOP ve zaman korunur", async () => {
  const originalIngest = trackingBuffer.ingest.bind(trackingBuffer);
  let captured: TrackingPosition | undefined;
  trackingBuffer.ingest = async (position) => {
    captured = position;
    return true;
  };

  try {
    const response = await POST(jsonRequest(EXAMPLE_PAYLOAD));
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assert.deepEqual(captured, {
      tagCode: "A1B2C3D400000001",
      x: 1.25,
      y: 0.8,
      pdop: 1.83,
      timestamp: "2026-07-21T14:30:15.123+03:00",
      sourceZoneId: "servis",
      sourceZoneName: "Servis",
      motionLabel: "unknown",
      mapId: "necmettin-servis",
    });
  } finally {
    trackingBuffer.ingest = originalIngest;
  }
});

test("yeni tek-tag sözleşmesi PDOP olmadan kabul edilir; koordinat, kimlik, etiket ve zaman korunur", async () => {
  const originalIngest = trackingBuffer.ingest;
  const captured: TrackingPosition[] = [];
  trackingBuffer.ingest = async position => { captured.push(position); return true; };
  try {
    for (const motion_label of ["moving", "stationary", "unknown", undefined]) {
      const payload = {
        type: "position", tag_id: "AAAABBBBCCCCDDDD", x: 12.48, y: 7.32,
        zone_id: "zone-a", zone_name: "Bölge A", timestamp: "2026-10-15T14:30:15.123+03:00", motion_label,
      };
      assert.equal((await POST(jsonRequest(payload))).status, 204);
      assert.deepEqual(captured.at(-1), {
        tagCode: payload.tag_id, x: payload.x, y: payload.y, timestamp: payload.timestamp,
        sourceZoneId: payload.zone_id, sourceZoneName: payload.zone_name, mapId: null,
        pdop: null, motionLabel: motion_label ?? "unknown",
      });
    }
    for (const tag_id of ["00001234567890123456", "9007199254740993"]) {
      assert.equal((await POST(jsonRequest({ ...EXAMPLE_PAYLOAD, tag_id, motion_label: "stationary" }))).status, 204);
      assert.equal(captured.at(-1)?.tagCode, tag_id);
      assert.equal(typeof captured.at(-1)?.tagCode, "string");
    }
  } finally { trackingBuffer.ingest = originalIngest; }
});

test("geçersiz motion_label konum akışına girmeden 400 döndürür", async () => {
  const originalIngest = trackingBuffer.ingest;
  let ingested = 0;
  trackingBuffer.ingest = async () => { ingested++; return true; };
  try {
    for (const motion_label of [null, "", "MOVING", "idle", " moving ", 0, false, {}, []]) {
      const response = await POST(jsonRequest({ ...EXAMPLE_PAYLOAD, motion_label }));
      assert.equal(response.status, 400);
      assert.match((await response.json() as { error: string }).error, /motion_label/);
    }
    assert.equal(ingested, 0);
  } finally { trackingBuffer.ingest = originalIngest; }
});

test("null ve bilinmeyen zone kabul edilir fakat haritaya çözülmez", async () => {
  const originalIngest = trackingBuffer.ingest.bind(trackingBuffer);
  const captured: TrackingPosition[] = [];
  trackingBuffer.ingest = async (position) => { captured.push(position); return false; };
  try {
    for (const zone of [null, "not-configured", "zone-a", "zone-b"]) {
      const response = await POST(jsonRequest({ ...EXAMPLE_PAYLOAD, zone_id: zone, zone_name: null }));
      assert.equal(response.status, 204);
      assert.equal(await response.text(), "");
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
    assert.equal(response.status, 204);
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
    const response = await POST(jsonRequest({ ...EXAMPLE_PAYLOAD, motion_label: "stationary" }));
    assert.equal(response.status, 204);
    const event = decoder.decode((await reader.read()).value);
    assert.match(event, /event: position/);
    assert.match(event, /"tagCode":"A1B2C3D400000001"/);
    assert.match(event, /"pdop":1\.83/);
    assert.match(event, /"motionLabel":"stationary"/);
    assert.match(event, /"timestamp":"2026-07-21T14:30:15.123\+03:00"/);
  } finally {
    trackingBuffer.ingest = originalIngest;
    abortController.abort();
  }
});

test("PDOP 20 dahil, sıfır, null ve eski eksik alan konumla birlikte kabul edilir", async () => {
  const originalIngest = trackingBuffer.ingest;
  const captured: TrackingPosition[] = [];
  trackingBuffer.ingest = async (position) => { captured.push(position); return true; };
  try {
    for (const pdop of [20, 0, null, undefined]) {
      const response = await POST(jsonRequest({ ...EXAMPLE_PAYLOAD, pdop, tag_id: "0000ABCDEF000001", zone_name: "Bölge A" }));
      assert.equal(response.status, 204);
      assert.equal(await response.text(), "");
      assert.equal(captured.at(-1)?.pdop, pdop ?? null);
      assert.equal(captured.at(-1)?.tagCode, "0000ABCDEF000001");
      assert.equal(captured.at(-1)?.sourceZoneName, "Bölge A");
    }
  } finally { trackingBuffer.ingest = originalIngest; }
});

test("PDOP harita çözümünden sonra tüm konum işlemlerinden önce elenir", async () => {
  const originalIngest = trackingBuffer.ingest;
  const originalResolve = zoneMapResolver.resolve;
  let ingested = 0, resolved = 0;
  trackingBuffer.ingest = async () => { ingested++; return true; };
  zoneMapResolver.resolve = async () => { resolved++; return { mapId: "necmettin-servis", resolved: true }; };
  try {
    for (const pdop of [20.000001, 21, 1_000_000]) {
      const response = await POST(jsonRequest({ ...EXAMPLE_PAYLOAD, pdop, quality: 1 }));
      assert.equal(response.status, 204);
      assert.equal(await response.text(), "");
    }
    assert.equal(resolved, 3);
    assert.equal(ingested, 0);
  } finally {
    trackingBuffer.ingest = originalIngest;
    zoneMapResolver.resolve = originalResolve;
  }
});

test("yoğun bakım isteği 70 dahil kabul edilir; daha büyük PDOP işlem görmez", async () => {
  const originalIngest = trackingBuffer.ingest;
  const captured: TrackingPosition[] = [];
  trackingBuffer.ingest = async position => { captured.push(position); return true; };
  try {
    for (const pdop of [21, 70, 70.000001]) {
      assert.equal((await POST(jsonRequest({ ...EXAMPLE_PAYLOAD, zone_id: "neuyogun", pdop }))).status, 204);
    }
    assert.deepEqual(captured.map(p => [p.mapId, p.pdop]), [["necmettin-yogun-bakim", 21], ["necmettin-yogun-bakim", 70]]);
    assert.equal((await POST(jsonRequest({ ...EXAMPLE_PAYLOAD, zone_id: null, pdop: 21 }))).status, 204);
    assert.equal(captured.length, 2);
  } finally { trackingBuffer.ingest = originalIngest; }
});

test("harita PDOP filtresi kapalıyken büyük sonlu değerler normal veri akışına devam eder", async () => {
  const originalIngest = trackingBuffer.ingest;
  const originalRead = mapTrackingFilterSettings.read;
  let captured: TrackingPosition | undefined;
  trackingBuffer.ingest = async position => { captured = position; return true; };
  mapTrackingFilterSettings.read = async mapId => {
    assert.equal(mapId, "necmettin-servis");
    return { enabled: false, maximumPdop: 20 };
  };
  try {
    assert.equal((await POST(jsonRequest({ ...EXAMPLE_PAYLOAD, pdop: 999 }))).status, 204);
    assert.equal(captured?.pdop, 999);
  } finally { trackingBuffer.ingest = originalIngest; mapTrackingFilterSettings.read = originalRead; }
});

test("PDOP string, boolean, nesne ve sonlu olmayan sayı olamaz", async () => {
  for (const pdop of ["1.83", true, {}, []]) {
    const response = await POST(jsonRequest({ ...EXAMPLE_PAYLOAD, pdop }));
    assert.equal(response.status, 400);
    assert.match((await response.json() as { error: string }).error, /pdop/);
  }
  for (const pdop of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => parsePositionPayload({ ...EXAMPLE_PAYLOAD, pdop }), /pdop/);
  }
});

test("geçersiz sözleşme payload'ları açıklayıcı 400 döndürür", async (context) => {
  const cases = [
    ["yanlış type", { ...EXAMPLE_PAYLOAD, type: "location" }],
    ["eksik tag_id", Object.fromEntries(Object.entries(EXAMPLE_PAYLOAD).filter(([field]) => field !== "tag_id"))],
    ["sayısal tag_id", { ...EXAMPLE_PAYLOAD, tag_id: 123456789 }],
    ["konum dizisi", [EXAMPLE_PAYLOAD]],
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
