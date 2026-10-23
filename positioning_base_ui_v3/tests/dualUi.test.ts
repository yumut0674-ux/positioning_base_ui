import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppSidebar } from "../src/app/components/AppSidebar";
import { resolveUiMode } from "../src/app/uiMode";

test("hostnames select the intended interface", () => {
  assert.equal(resolveUiMode("neu-admin.gekon.com.tr"), "admin");
  assert.equal(resolveUiMode("NEU-ADMIN.GEKON.COM.TR:443"), "admin");
  assert.equal(resolveUiMode("localhost:3000"), "admin");
  assert.equal(resolveUiMode("neu-demo.gekon.com.tr"), "demo");
  assert.equal(resolveUiMode("another.gekon.com.tr"), "demo");
  assert.equal(resolveUiMode(null), "demo");
});

test("demo navigation shows shared panels and omits management panels", () => {
  const html = renderToStaticMarkup(createElement(AppSidebar, {
    mode: "demo",
    activeView: "map",
    collapsed: false,
    mobileOpen: false,
    onMobileClose: () => {},
    onViewChange: () => {},
  }));

  for (const label of ["Canlı Harita", "Rota Geçmişi", "Destek ve İletişim"])
    assert.match(html, new RegExp(label));
  for (const label of ["İzlenen Varlıklar", "Referans İstasyonları", "Oda/Bölge", "Analizler", "Saha ayarları", "Gekon AI"])
    assert.ok(!html.includes(label), `${label} should be absent from demo navigation`);
});

test("admin navigation exposes Gekon AI management", () => {
  const html = renderToStaticMarkup(createElement(AppSidebar, {
    mode: "admin", activeView: "gekon-ai", collapsed: false, mobileOpen: false,
    onMobileClose: () => {}, onViewChange: () => {},
  }));
  assert.match(html, /Gekon AI/);
  assert.match(html, /aria-label="Gekon AI"/);
});
