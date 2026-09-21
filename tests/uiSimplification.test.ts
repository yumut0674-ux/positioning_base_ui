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
  assert.match(html, /aria-label="Analizler"/);
});

test("existing analyses navigation opens through the active workspace style",()=>{
  let selected="";const html=renderToStaticMarkup(createElement(AppSidebar,{activeView:"analyses",collapsed:false,mobileOpen:false,onMobileClose:()=>{},onViewChange:view=>{selected=view;}}));
  assert.match(html,/class="active"[^>]*aria-label="Analizler"/);assert.equal(selected,"");
});

test("status strip keeps tracking-label count, FPS, and clock only", () => {
  const html = renderToStaticMarkup(createElement(StatusStrip));

  assert.match(html, /AKTİF KATTA \/ .*AKIŞTA/);
  assert.match(html, /GÖRÜNTÜLEME/);
  assert.match(html, /UTC\+3/);
  assert.doesNotMatch(html, /SİMÜLASYON BAĞLANTISI|24 ms gecikme|SON EŞİTLEME|ŞİMDİ/);
});
