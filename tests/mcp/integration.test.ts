import assert from "node:assert/strict";
import test from "node:test";
import { HttpLocationApiClient } from "../../mcp/client/locationApiClient";

test("gerçek location REST API salt-okunur arama entegrasyonu", {
  skip: process.env.UWB_MCP_INTEGRATION !== "1" ? "UWB_MCP_INTEGRATION=1 ile etkinleştirilir" : false,
}, async () => {
  const client = new HttpLocationApiClient();
  const result = await client.searchEntities({ query: "TAG-028", limit: 10 });
  assert.ok("data" in result);
});
