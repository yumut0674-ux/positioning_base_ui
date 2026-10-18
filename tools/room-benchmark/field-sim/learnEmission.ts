/**
 * Saha kalibrasyonu: gerçek ziyaretlerden (oda test paneli truth) her yerin (oda / koridor) Jetson
 * noktalarının haritada nereye düştüğünü öğrenir ve motorun geometrik olasılığını düzelten tabloyu yazar.
 *
 * node --import tsx tools/room-benchmark/field-sim/learnEmission.ts --out room-emission.json \
 *   --set positions.jsonl truth1.json truth2.json --set positions2.jsonl truth3.json ...
 *   [--map necmettin-servis] [--zone servis] [--alpha 30] [--cell 1] [--min 0.2] [--max 8]
 *
 * factor[place][cell] = P_saha(cell | place) / P_geometrik(cell | place); veri olmayan yerde 1'e yakın.
 * alpha: geometrik önsele verilen sahte nokta sayısı (büyük = temkinli).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compileRegionsConfig } from "../../../src/server/regionEngine/configLoader";
import { RoomHmmEngine, type EmissionCorrection } from "../../../src/server/regionEngine/RoomHmmEngine";
import type { RegionsConfig } from "../../../src/features/regions/types/region.types";

const args = process.argv.slice(2);
const opt = (key: string, fallback: string) => { const i = args.indexOf(`--${key}`); return i < 0 ? fallback : args[i + 1]; };
const mapId = opt("map", "necmettin-servis"), zone = opt("zone", mapId === "necmettin-servis" ? "servis" : "neuyogun");
const alpha = Number(opt("alpha", "30")), cell = Number(opt("cell", "1")), minF = Number(opt("min", "0.2")), maxF = Number(opt("max", "8"));
const outFile = opt("out", "room-emission.json");
const config = compileRegionsConfig(JSON.parse(readFileSync(path.resolve("config/maps", mapId, "regions.json"), "utf8")) as RegionsConfig);

// Geometric prior straight from the engine's own spatial model (so a missing table changes nothing).
const engine = new RoomHmmEngine(() => {}, 1000, Date.now, false) as unknown as {
  enable(c: typeof config): void; spatial(p: { x: number; y: number }): Float64Array;
  model: { corridorMove: number; roomOpen: number[] };
};
engine.enable(config);
const places = ["corridor", ...config.regions.map(r => r.id)];
const stateOf = (place: string) => place === "corridor" ? engine.model.corridorMove : engine.model.roomOpen[config.regions.findIndex(r => r.id === place)];
const all = [...config.regions.flatMap(r => r.polygon), ...config.corridors.flatMap(c => c.polygon)];
const minX = Math.floor(Math.min(...all.map(p => p.x)) / cell) - 3, maxX = Math.ceil(Math.max(...all.map(p => p.x)) / cell) + 3;
const minY = Math.floor(Math.min(...all.map(p => p.y)) / cell) - 3, maxY = Math.ceil(Math.max(...all.map(p => p.y)) / cell) + 3;
const cells: string[] = [], prior: Record<string, Record<string, number>> = Object.fromEntries(places.map(p => [p, {}]));
for (let ix = minX; ix <= maxX; ix++) for (let iy = minY; iy <= maxY; iy++) {
  const key = `${ix},${iy}`; cells.push(key);
  // Average over a 3×3 sub-grid so thin door strips are represented.
  const acc = new Float64Array(places.length);
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
    const l = engine.spatial({ x: (ix + (a + 0.5) / 3) * cell, y: (iy + (b + 0.5) / 3) * cell });
    places.forEach((place, i) => { acc[i] += l[stateOf(place)] / 9; });
  }
  places.forEach((place, i) => { prior[place][key] = acc[i]; });
}
for (const place of places) {
  const total = Object.values(prior[place]).reduce((s, v) => s + v, 0);
  for (const key of cells) prior[place][key] = Math.max(prior[place][key] / total, 1e-6);
}

const counts: Record<string, Record<string, number>> = Object.fromEntries(places.map(p => [p, {}]));
const totals: Record<string, number> = Object.fromEntries(places.map(p => [p, 0]));
for (let i = 0; i < args.length; i++) if (args[i] === "--set") {
  const positions = args[++i], truths: string[] = [];
  while (args[i + 1] && !args[i + 1].startsWith("--")) truths.push(args[++i]);
  const rows = readFileSync(positions, "utf8").split("\n").filter(Boolean)
    .map(line => JSON.parse(line.replace(/:\s*(-?Infinity|NaN)/g, ":null")) as Record<string, unknown>).filter(r => r.zone_id === zone);
  for (const file of truths) {
    const truth = JSON.parse(readFileSync(file, "utf8")) as { test: { from: string; to: string }; visits: { roomId: string; from: string; to: string }[]; groups: { tagCodes: string[] }[] };
    const tags = new Set(truth.groups.flatMap(g => g.tagCodes.map(t => t.toUpperCase())));
    const from = Date.parse(truth.test.from) / 1000, to = Date.parse(truth.test.to) / 1000;
    const visits = truth.visits.map(v => ({ room: v.roomId, from: Date.parse(v.from) / 1000, to: Date.parse(v.to) / 1000 }));
    for (const row of rows) {
      const at = Number(row.updated_at);
      if (at < from || at > to || !tags.has(String(row.uid).toUpperCase())) continue;
      if (typeof row.geometry_pdop === "number" && row.geometry_pdop > 20) continue;
      // Skip the ±2 s around every boundary: panel taps and walking through the door are ambiguous.
      if (visits.some(v => Math.abs(at - v.from) < 2 || Math.abs(at - v.to) < 2)) continue;
      const visit = visits.find(v => at >= v.from && at <= v.to);
      const place = visit ? visit.room : "corridor";
      if (!(place in counts)) continue;
      const key = `${Math.floor(Number(row.x) / cell)},${Math.floor(Number(row.y) / cell)}`;
      if (!(key in prior[place])) continue;
      counts[place][key] = (counts[place][key] ?? 0) + 1; totals[place]++;
    }
  }
}

const table: EmissionCorrection & { note: string; samples: Record<string, number> } = {
  note: `learnEmission alpha=${alpha} cell=${cell}`, cellSize: cell, samples: totals,
  places: {},
};
for (const place of places) {
  const n = totals[place];
  if (!n) continue;
  const rest = Math.min(maxF, Math.max(minF, alpha / (n + alpha)));
  const out: Record<string, number> = {};
  for (const key of cells) {
    const learned = ((counts[place][key] ?? 0) + alpha * prior[place][key]) / (n + alpha);
    const factor = Math.min(maxF, Math.max(minF, learned / prior[place][key]));
    if (Math.abs(Math.log(factor / rest)) > 0.05) out[key] = Math.round(factor * 1000) / 1000;
  }
  (table.places as Record<string, { rest: number; cells: Record<string, number> }>)[place] = { rest: Math.round(rest * 1000) / 1000, cells: out };
}
writeFileSync(outFile, JSON.stringify(table) + "\n");
const name = (id: string) => config.regions.find(r => r.id === id)?.name ?? id;
console.log(Object.entries(totals).map(([p, n]) => `${name(p)}:${n}`).join(" "));
