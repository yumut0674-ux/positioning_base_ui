import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const serverUrl = new URL("../dist/server/index.js", import.meta.url);
  serverUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: handleRequest } = await import(serverUrl.href);

  return handleRequest(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server renders the GEKON application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="tr">/i);
  assert.match(html, /<title>GEKON IPS Kontrol<\/title>/i);
  assert.match(html, /Endüstriyel iç mekân konumlandırma ve gerçek zamanlı varlık izleme konsolu\./i);
  assert.match(html, /property="og:title" content="GEKON IPS Kontrol"/i);
  assert.doesNotMatch(html, /codex-preview|Codex is working|Your site is taking shape/i);
});
