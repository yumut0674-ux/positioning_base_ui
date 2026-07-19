import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { HttpLocationApiClient } from "../../mcp/client/locationApiClient";
import { LocationError } from "../../src/server/location/locationErrors";
import { errorEnvelope } from "../../src/server/location/location.types";
import { searchEnvelope } from "./fixtures/testData";

test("istemci query parametrelerini encode eder ve opsiyonel token gönderir", async () => {
  let seenUrl = "";
  let seenAuthorization = "";
  const fetchImplementation: typeof fetch = async (input, init) => {
    seenUrl = String(input);
    seenAuthorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify(searchEnvelope()), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new HttpLocationApiClient({
    baseUrl: "http://localhost:3000", token: "secret-test-token", fetchImplementation,
  });
  await client.searchEntities({ query: "Palet 28 & özel", limit: 10 });
  const url = new URL(seenUrl);
  assert.equal(url.searchParams.get("q"), "Palet 28 & özel");
  assert.equal(seenAuthorization, "Bearer secret-test-token");
});

test("API timeout UPSTREAM_TIMEOUT olur", async () => {
  const fetchImplementation: typeof fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
  const client = new HttpLocationApiClient({ timeoutMs: 100, fetchImplementation });
  await assert.rejects(
    () => client.getCurrentLocation(28),
    (error) => error instanceof LocationError && error.code === "UPSTREAM_TIMEOUT" && error.retryable,
  );
});

test("API 500 ve bozuk JSON UPSTREAM_UNAVAILABLE olur", async () => {
  for (const response of [
    new Response(JSON.stringify({ error: "password=do-not-leak" }), { status: 500 }),
    new Response("<html>broken</html>", { status: 200 }),
  ]) {
    const client = new HttpLocationApiClient({ fetchImplementation: async () => response.clone() });
    await assert.rejects(
      () => client.getCurrentLocation(28),
      (error) => error instanceof LocationError
        && error.code === "UPSTREAM_UNAVAILABLE"
        && !error.message.includes("password"),
    );
  }
});

test("doğrulanmış 4xx hata kodu güvenli yerel mesaja çevrilir", async () => {
  const upstream = errorEnvelope("ENTITY_NOT_FOUND", "raw database detail", false);
  const client = new HttpLocationApiClient({
    fetchImplementation: async () => new Response(JSON.stringify(upstream), { status: 404 }),
  });
  await assert.rejects(
    () => client.getCurrentLocation(999),
    (error) => error instanceof LocationError
      && error.code === "ENTITY_NOT_FOUND"
      && !error.message.includes("database"),
  );
});

test("stdio sunucu kaynağında stdout logu bulunmaz", async () => {
  const source = await readFile(new URL("../../mcp/server.ts", import.meta.url), "utf8");
  assert.equal(source.includes("console.log"), false);
  assert.equal(source.includes("process.stdout.write"), false);
});
