import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppHeader } from "../src/app/components/AppHeader";
import { AppSidebar } from "../src/app/components/AppSidebar";
import { StatusStrip } from "../src/app/components/StatusStrip";

test("header omits the notifications control", () => {
  const html = renderToStaticMarkup(createElement(AppHeader, {
    sidebarCollapsed: false,
    mobileMenuOpen: false,
    onSidebarToggle: () => {},
  }));

  assert.doesNotMatch(html, /Bildirimler|notification/);
  assert.match(html, /aria-label="Ara"/);
});

test("sidebar uses explicit views without the alarms entry or badge", () => {
  const html = renderToStaticMarkup(createElement(AppSidebar, {
    activeView: "map",
    collapsed: true,
    mobileOpen: false,
    onMobileClose: () => {},
    onViewChange: () => {},
  }));

  assert.doesNotMatch(html, /Alarmlar|>02</);
  assert.match(html, /Referans İstasyonları/);
  assert.match(html, /aria-label="Canlı Harita"/);
  assert.match(html, /aria-label="Oda\/Bölge"/);
});

test("status strip keeps tracking-label count, FPS, and clock only", () => {
  const html = renderToStaticMarkup(createElement(StatusStrip));

  assert.match(html, /TAKİP ETİKETİ AKIŞTA/);
  assert.match(html, /GÖRÜNTÜLEME/);
  assert.match(html, /UTC\+3/);
  assert.doesNotMatch(html, /SİMÜLASYON BAĞLANTISI|24 ms gecikme|SON EŞİTLEME|ŞİMDİ/);
});
