import assert from "node:assert/strict";
import test from "node:test";
import { createGetLocationAtTimeHandler } from "../../mcp/tools/getLocationAtTime";
import { atEnvelope, FixtureClient, now, structured } from "./fixtures/testData";

test("belirli zamanda en yakın kayıt ve fark saniyesi döner", async () => {
  const result = await createGetLocationAtTimeHandler(new FixtureClient(), now)({
    entityId: 28, at: "2026-07-18T14:00:00+03:00",
  });
  const data = structured(result).data as { differenceSeconds: number; observedAt: string };
  assert.equal(data.differenceSeconds, 12);
  assert.equal(data.observedAt, "2026-07-18T13:59:48+03:00");
});

test("tolerans dışında kayıt yoksa no_data döner", async () => {
  const client = new FixtureClient();
  client.atResponse = atEnvelope(false);
  const result = await createGetLocationAtTimeHandler(client, now)({
    entityId: 28, at: "2026-07-18T14:00:00+03:00", toleranceSeconds: 60,
  });
  assert.equal((structured(result).meta as { dataStatus: string }).dataStatus, "no_data");
  assert.equal((structured(result).data as { position: unknown }).position, null);
});

test("geçersiz veya timezone içermeyen tarih VALIDATION_ERROR döner", async () => {
  const handler = createGetLocationAtTimeHandler(new FixtureClient(), now);
  for (const at of ["not-a-date", "2026-07-18T14:00:00"]) {
    const result = await handler({ entityId: 28, at });
    assert.equal((structured(result).error as { code: string }).code, "VALIDATION_ERROR");
  }
});
