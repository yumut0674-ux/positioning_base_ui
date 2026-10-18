/**
 * Saha kalibrasyonu: gerçek oda ziyaretlerinden (truth) Jetson'un oda içi noktalarını hangi odaya
 * koyduğunu öğrenir ve motorun kullandığı "oda karışıklık" tablosunu yazar.
 *
 * node --import tsx tools/room-benchmark/field-sim/learnConfusion.ts --out room-confusion.json \
 *   --set positions.jsonl truth1.json truth2.json --set positions2.jsonl truth3.json ...
 *   [--map necmettin-servis] [--zone servis] [--alpha 8]
 *
 * Çıktı: { trueRoom: { observedRoom: pay } } — her satır toplamı 1. Az verili odalar geometrik
 * önsel dağılıma (kendi oda ağırlıklı, karşı/komşu oda az) yakın kalır (alpha sahte nokta).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compileRegionsConfig } from "../../../src/server/regionEngine/configLoader";
import { pointInPolygon, distanceToSegment } from "../../../src/server/regionEngine/geometry";
import type { RegionsConfig } from "../../../src/features/regions/types/region.types";

type P = { x: number; y: number };
const args = process.argv.slice(2);
const opt = (key: string, fallback: string) => { const i = args.indexOf(`--${key}`); return i < 0 ? fallback : args[i + 1]; };
const mapId = opt("map", "necmettin-servis"), zone = opt("zone", mapId === "necmettin-servis" ? "servis" : "neuyogun");
const alpha = Number(opt("alpha", "8")), outFile = opt("out", "room-confusion.json");
const config = compileRegionsConfig(JSON.parse(readFileSync(path.resolve("config/maps", mapId, "regions.json"), "utf8")) as RegionsConfig);
const rooms = config.regions;

// Geometric prior: own room dominant, the room whose door faces it across the corridor and the
// rooms sharing a wall get a small share (the field errors seen without calibration).
const doorOf = (index: number) => rooms[index].entrances[0];
const roomGap = (a: number, b: number) => Math.min(...rooms[a].polygon.flatMap(p => rooms[b].polygon.map((q, j, all) => distanceToSegment(p, q, all[(j + 1) % all.length]))));
const prior = rooms.map((_, r) => {
  const w = rooms.map((__, k) => {
    if (k === r) return 6;
    const a = doorOf(r), b = doorOf(k);
    if (a?.inwardNormal && b?.inwardNormal && a.inwardNormal.x * b.inwardNormal.x + a.inwardNormal.y * b.inwardNormal.y < -0.7
      && Math.abs(-(b.x - a.x) * a.inwardNormal.y + (b.y - a.y) * a.inwardNormal.x) <= 1.5) return 1.5;
    return roomGap(r, k) <= 0.5 ? 1 : 0.05;
  });
  const total = w.reduce((s, v) => s + v, 0);
  return w.map(v => v / total);
});

const counts = rooms.map(() => rooms.map(() => 0));
const sets: { positions: string; truths: string[] }[] = [];
for (let i = 0; i < args.length; i++) if (args[i] === "--set") {
  const set = { positions: args[++i], truths: [] as string[] };
  while (args[i + 1] && !args[i + 1].startsWith("--")) set.truths.push(args[++i]);
  sets.push(set);
}
for (const set of sets) {
  const rows = readFileSync(set.positions, "utf8").split("\n").filter(Boolean)
    .map(line => JSON.parse(line.replace(/:\s*(-?Infinity|NaN)/g, ":null")) as Record<string, unknown>).filter(r => r.zone_id === zone);
  for (const file of set.truths) {
    const truth = JSON.parse(readFileSync(file, "utf8")) as { visits: { roomId: string; from: string; to: string }[]; groups: { tagCodes: string[] }[] };
    const tags = new Set(truth.groups.flatMap(g => g.tagCodes.map(t => t.toUpperCase())));
    for (const visit of truth.visits) {
      const r = rooms.findIndex(room => room.id === visit.roomId);
      if (r < 0) continue;
      const from = Date.parse(visit.from) / 1000, to = Date.parse(visit.to) / 1000;
      for (const row of rows) {
        const at = Number(row.updated_at);
        if (at < from || at > to || !tags.has(String(row.uid).toUpperCase())) continue;
        const pdop = row.geometry_pdop;
        if (typeof pdop === "number" && pdop > 20 && !args.includes("--all-pdop")) continue;
        const point: P = { x: Number(row.x), y: Number(row.y) };
        const k = rooms.findIndex(room => pointInPolygon(point, room));
        if (k >= 0) counts[r][k]++;
      }
    }
  }
}
const result: Record<string, Record<string, number>> = {};
rooms.forEach((room, r) => {
  const n = counts[r].reduce((s, v) => s + v, 0);
  const row: Record<string, number> = {};
  rooms.forEach((other, k) => {
    const share = (counts[r][k] + alpha * prior[r][k]) / (n + alpha);
    if (share >= 0.005) row[other.id] = Math.round(share * 1000) / 1000;
  });
  result[room.id] = row;
});
writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n");
const name = (id: string) => rooms.find(r => r.id === id)?.name ?? id;
for (const [r, row] of Object.entries(result)) {
  const n = counts[rooms.findIndex(x => x.id === r)].reduce((s, v) => s + v, 0);
  const top = Object.entries(row).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${name(k)} %${Math.round(v * 100)}`).join(", ");
  console.log(`${name(r).padEnd(9)} ${String(n).padStart(4)} nokta → ${top}`);
}
