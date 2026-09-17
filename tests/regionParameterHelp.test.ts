import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  filterParameterHelpItems,
  INFERENCE_PARAMETER_HELP,
  nextParameterHelpVisibility,
} from "../src/features/regions/config/inferenceParameterHelp";
import {
  DEFAULT_DOOR_INFERENCE_SETTINGS,
  DEFAULT_REGION_ENGINE_SETTINGS,
} from "../src/features/regions/config/regionInferenceSettings";

const root = process.cwd();
const panelSource = readFileSync(path.join(root, "src/features/regions/components/RegionManagementPanel.tsx"), "utf8");
const helpSource = readFileSync(path.join(root, "src/features/regions/components/ParameterHelpPanel.tsx"), "utf8");
const cssSource = readFileSync(path.join(root, "src/features/regions/components/regions.module.css"), "utf8");
const ids = new Set(INFERENCE_PARAMETER_HELP.map(item => item.id));

test("help button is accessible and visibility actions open and close the panel", () => {
  assert.match(panelSource, /<CircleHelp size=\{16\}/);
  assert.match(panelSource, /aria-label="Özellik ve hesaplama rehberini aç"/);
  assert.match(panelSource, /aria-expanded=\{propertyHelpOpen\}/);
  assert.match(panelSource, /aria-controls="region-property-help"/);
  assert.match(panelSource, /id="region-property-help"/);
  assert.equal(nextParameterHelpVisibility(false, "toggle"), true);
  assert.equal(nextParameterHelpVisibility(true, "toggle"), false);
  assert.equal(nextParameterHelpVisibility(true, "close"), false);
  assert.equal(nextParameterHelpVisibility(true, "escape"), false);
  assert.match(helpSource, /event\.key === "Escape"/);
  assert.match(helpSource, /Özellik ve hesaplama rehberini kapat/);
});

test("help search filters by label and description without Turkish case sensitivity", () => {
  assert(filterParameterHelpItems("GİRİŞ KANIT SÜRESİ").some(item => item.id === "entryEvidenceDurationMs"));
  assert(filterParameterHelpItems("motorun kalıcı teknik kimliği").some(item => item.id === "name"));
  assert(filterParameterHelpItems("ODA/BÖLGE ADI").some(item => item.id === "name"));
  assert(filterParameterHelpItems("başlangıç skoru", true).some(item => item.id === "baseScore"));
  assert.equal(filterParameterHelpItems("", false).some(item => item.advanced), false);
  assert.equal(filterParameterHelpItems("bu-parametre-yok").length, 0);
  assert.match(helpSource, /Sonuç bulunamadı/);
  assert.match(helpSource, /setQuery\(""\)/);
});

test("catalog covers base room, every engine setting, and every door setting", () => {
  const baseIds = [
    "name", "id", "color", "kind", "polygon", "roomCenter", "entrances",
    "pixelCoordinates", "worldCoordinates", "coverage", "expectedIntervalMs",
    "wallBandMeters", "sharedWallBandMeters",
  ];
  for (const id of baseIds) assert(ids.has(id), `Eksik temel yardım: ${id}`);
  for (const id of Object.keys(DEFAULT_REGION_ENGINE_SETTINGS)) {
    if (id !== "doorDefaults") assert(ids.has(id), `Eksik motor yardımı: ${id}`);
  }
  assert(ids.has("evidenceDurationMs"), "Eski evidenceDurationMs uyumluluk alanı açıklanmalı");
  for (const id of Object.keys(DEFAULT_DOOR_INFERENCE_SETTINGS)) {
    assert(ids.has(id), `Eksik kapı yardımı: ${id}`);
  }
  for (const id of ["doorLabel", "connectsTo", "widthMeters", "inwardNormal", "approachDepthMeters", "crossingDepthMeters"]) {
    assert(ids.has(id), `Eksik kapı geometrisi yardımı: ${id}`);
  }
});

test("door roles, score warning, override order and verified formulas are documented", () => {
  const role = INFERENCE_PARAMETER_HELP.find(item => item.id === "evidenceMode");
  assert(role);
  for (const value of ["required", "preferred", "optional", "ignored"]) assert.match(role.description, new RegExp(value));
  assert.match(helpSource, /Kanıt skoru kalibre edilmiş bir olasılık değildir/);
  assert.match(helpSource, /0,80 değeri doğrudan %80 doğruluk anlamına gelmez/);
  assert.match(INFERENCE_PARAMETER_HELP.find(item => item.id === "overridePriority")?.formula ?? "", /Kapı özel değeri[\s\S]*Oda özel değeri[\s\S]*Global değer[\s\S]*Sistem varsayılanı/);
  assert.match(INFERENCE_PARAMETER_HELP.find(item => item.id === "entryCalculation")?.formula ?? "", /ceil\(girişSayısı × kapıSayıÇarpanı\)/);
  assert.match(INFERENCE_PARAMETER_HELP.find(item => item.id === "coverageCalculation")?.formula ?? "", /max\(ölçümRitmi, beklenenAralık\) × kapsamaÇarpanı/);
  assert.match(INFERENCE_PARAMETER_HELP.find(item => item.id === "preferredDoorExample")?.formula ?? "", /ceil\(3 × 1,5\) = 5/);
  assert.match(helpSource, /styles\.parameterFormula/);
});

test("opening help keeps the selected room form mounted and cannot mutate config", () => {
  const helpIndex = panelSource.indexOf("<ParameterHelpPanel");
  const formIndex = panelSource.indexOf("{!selectedRegion ?");
  assert(helpIndex > 0 && formIndex > helpIndex, "Rehber seçili oda koşulunun dışında, formdan önce kalıcı render edilmeli");
  assert.doesNotMatch(helpSource, /onConfigChange|setConfig|fetch\(|\/api\/regions/);
  assert.match(helpSource, /Bu rehber salt okunurdur/);
  const defaultsBefore = JSON.stringify({ engine: DEFAULT_REGION_ENGINE_SETTINGS, door: DEFAULT_DOOR_INFERENCE_SETTINGS });
  filterParameterHelpItems("kapı", true);
  assert.equal(JSON.stringify({ engine: DEFAULT_REGION_ENGINE_SETTINGS, door: DEFAULT_DOOR_INFERENCE_SETTINGS }), defaultsBefore);
});

test("responsive property widths expand without changing the flexible map column", () => {
  assert.match(cssSource, /grid-template-columns:\s*210px minmax\(0, 1fr\) 355px/);
  assert.match(cssSource, /@media \(max-width: 1180px\)[\s\S]*?grid-template-columns:\s*175px minmax\(0,1fr\) 305px/);
  assert.match(cssSource, /@media \(max-width: 850px\)[\s\S]*?grid-template-columns:\s*135px minmax\(320px,1fr\) 260px/);
  assert.match(cssSource, /@media \(max-width: 680px\)[\s\S]*?\.zonePanel, \.properties \{ width: 100%/);
  assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)/);
});
