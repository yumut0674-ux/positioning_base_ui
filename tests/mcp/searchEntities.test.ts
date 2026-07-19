import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../mcp/server";
import { createSearchEntitiesHandler } from "../../mcp/tools/searchEntities";
import { FixtureClient, MATCH, now, searchEnvelope, structured } from "./fixtures/testData";

test("tam ürün adı, ürün kodu ve tag kodu aramaları girdiyi korur", async () => {
  for (const query of ["Palet 28", "PALLET-028", "TAG-028"]) {
    const client = new FixtureClient();
    const result = await createSearchEntitiesHandler(client, now)({ query });
    assert.equal((client.lastInput as { query: string }).query, query);
    assert.deepEqual((structured(result).data as { matches: unknown[] }).matches, [MATCH]);
  }
});

test("çoklu eşleşme ambiguous döner ve tek seçim alanı üretmez", async () => {
  const client = new FixtureClient();
  client.searchResponse = searchEnvelope([MATCH, { ...MATCH, entityId: 29, entityCode: "PALLET-029", name: "Palet 29" }]);
  const result = await createSearchEntitiesHandler(client, now)({ query: "Palet" });
  const body = structured(result);
  assert.equal((body.meta as { dataStatus: string }).dataStatus, "ambiguous");
  assert.equal("selected" in (body.data as object), false);
});

test("bulunamayan ürün no_data döner", async () => {
  const client = new FixtureClient();
  client.searchResponse = searchEnvelope([]);
  const result = await createSearchEntitiesHandler(client, now)({ query: "yok" });
  assert.equal((structured(result).meta as { dataStatus: string }).dataStatus, "no_data");
});

test("boş query ve limit aşımı VALIDATION_ERROR döner", async () => {
  const handler = createSearchEntitiesHandler(new FixtureClient(), now);
  for (const input of [{ query: "   " }, { query: "Palet", limit: 21 }]) {
    const result = await handler(input);
    assert.equal(result.isError, true);
    assert.equal(((structured(result).error as { code: string }).code), "VALIDATION_ERROR");
  }
});

test("MCP sunucusu dört salt-okunur tool kaydeder", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(new FixtureClient());
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    "get_current_location", "get_location_at_time", "get_location_history", "search_entities",
  ]);
  assert.ok(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true));
  await client.close();
  await server.close();
});
