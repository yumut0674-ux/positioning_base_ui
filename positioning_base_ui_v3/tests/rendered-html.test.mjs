import assert from "node:assert/strict";
import test from "node:test";

async function render(host = "localhost", pathname = "/") {
  const serverUrl = new URL("../dist/server/index.js", import.meta.url);
  serverUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: handleRequest } = await import(serverUrl.href);

  return handleRequest(
    new Request(`http://${host}${pathname}`, {
      headers: { accept: "text/html", host },
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

test("each hostname renders its own interface and demo redirects direct management pages", async () => {
  const demo = await render("neu-demo.gekon.com.tr");
  const admin = await render("neu-admin.gekon.com.tr");
  assert.match(await demo.text(), /mode\\":\\"demo/);
  assert.match(await admin.text(), /mode\\":\\"admin/);

  for (const pathname of ["/tags", "/anchors"]) {
    const demoPage = await render("neu-demo.gekon.com.tr", pathname);
    const adminPage = await render("neu-admin.gekon.com.tr", pathname);
    assert.equal(demoPage.status, 307);
    assert.equal(demoPage.headers.get("location"), "http://neu-demo.gekon.com.tr/");
    assert.equal(adminPage.status, 200);
  }
});
