/**
 * Saha benzeri simülasyon: Jetson motorunun gerçek davranışını (koridor+kapı girintisi
 * çokgenine kıstırma, odada veri kesilmesi, tekil sıçramalar, komşu kapıya kayma,
 * hareketsiz tagın 10 sn blink'i, 1 sn çözüm beklemesi) taklit eden paketler üretir,
 * eski kural motoru ile yeni olasılıksal motoru aynı truth ile puanlar.
 *
 * node --import tsx tools/room-benchmark/field-sim/simulate.ts [--seeds 20] [--json out.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compileRegionsConfig } from "../../../src/server/regionEngine/configLoader";
import { RegionPositionEngine } from "../../../src/server/regionEngine/RegionPositionEngine";
import { RoomHmmEngine } from "../../../src/server/regionEngine/RoomHmmEngine";
import type { CompiledRegionsConfig } from "../../../src/server/regionEngine/types";
import type { RegionsConfig } from "../../../src/features/regions/types/region.types";
import { replayRows, type ReplayEngineFactory } from "../replay";
import type { RawRow, Truth } from "../model";

type P = { x: number; y: number };
const here = path.dirname(new URL(import.meta.url).pathname);
const jetson = JSON.parse(readFileSync(path.join(here, "jetson-zones.json"), "utf8")) as { zones: Record<string, [number, number][]> };

// ------------------------------------------------------------ deterministic RNG
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const normal = () => { const u = Math.max(1e-9, next()), v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return { next, normal };
}

// ------------------------------------------------------------ geometry
function inPoly(p: P, poly: readonly P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function project(p: P, poly: readonly P[]): P {
  if (inPoly(p, poly)) return p;
  let best = p, bd = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const q = { x: a.x + t * dx, y: a.y + t * dy }, d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bd) { bd = d; best = q; }
  }
  // pull 3 cm inside so the clamped point is in the zone
  return best;
}

// ------------------------------------------------------------ site model
interface Site {
  name: string; config: CompiledRegionsConfig; raw: RegionsConfig; zone: P[];
  leakyRooms: Set<string>; holes: { poly: P[] }[];
}
function loadSite(mapId: string, zoneId: string, leakyRooms: string[] = [], holes: P[][] = []): Site {
  const raw = JSON.parse(readFileSync(path.resolve("config/maps", mapId, "regions.json"), "utf8")) as RegionsConfig;
  return { name: mapId, raw, config: compileRegionsConfig(raw), zone: jetson.zones[zoneId].map(([x, y]) => ({ x, y })),
    leakyRooms: new Set(leakyRooms), holes: holes.map(poly => ({ poly })) };
}
const room = (site: Site, id: string) => site.config.regions.find(r => r.id === id)!;
const door = (site: Site, id: string) => room(site, id).entrances[0];
function doorFront(site: Site, id: string, out = 0.9, lateral = 0): P {
  const d = door(site, id), n = d.inwardNormal!, t = { x: -n.y, y: n.x };
  return { x: d.x - n.x * out + t.x * lateral, y: d.y - n.y * out + t.y * lateral };
}
function roomInside(site: Site, id: string, depth = 2.5, lateral = 0): P {
  const d = door(site, id), n = d.inwardNormal!, t = { x: -n.y, y: n.x };
  return { x: d.x + n.x * depth + t.x * lateral, y: d.y + n.y * depth + t.y * lateral };
}
function truthPlace(site: Site, p: P): string | null {
  return site.config.regions.find(r => inPoly(p, r.polygon))?.id ?? null;
}

// ------------------------------------------------------------ routes
type Leg = { walk: P; speed?: number; silent?: boolean } | { dwell: number; still?: boolean } | { inject: P[] } | { silence: number };
interface Route { start: P; legs: Leg[] }
interface TrueSample { t: number; p: P; moving: boolean; silent: boolean; inject?: P[] }

function sampleRoute(route: Route, t0: number, stepMs = 100): TrueSample[] {
  const out: TrueSample[] = []; let t = t0, p = route.start;
  for (const leg of route.legs) {
    if ("walk" in leg) {
      const speed = leg.speed ?? 1.2, d = Math.hypot(leg.walk.x - p.x, leg.walk.y - p.y), n = Math.max(1, Math.ceil(d / speed / (stepMs / 1000)));
      for (let i = 1; i <= n; i++) { out.push({ t, p: { x: p.x + (leg.walk.x - p.x) * i / n, y: p.y + (leg.walk.y - p.y) * i / n }, moving: true, silent: !!leg.silent }); t += stepMs; }
      p = leg.walk;
    } else if ("dwell" in leg) {
      for (let k = 0; k < leg.dwell / stepMs; k++) { out.push({ t, p, moving: !leg.still, silent: false }); t += stepMs; }
    } else if ("silence" in leg) {
      for (let k = 0; k < leg.silence / stepMs; k++) { out.push({ t, p, moving: false, silent: true }); t += stepMs; }
    } else { out.push({ t, p, moving: true, silent: false, inject: leg.inject }); }
  }
  return out;
}

// Tag firmware reports its IMU state with every blink (Jetson `motion`); --no-motion simulates older Jetsons.
const SEND_MOTION = !process.argv.includes("--no-motion");

interface NoiseModel { corridorRecv: number; sigma: number; spikeRate: number; roomDecayM: number; neighborShiftRate: number; latencyMs: number }
const DEFAULT_NOISE: NoiseModel = { corridorRecv: 0.35, sigma: 0.25, spikeRate: 0.015, roomDecayM: 0.6, neighborShiftRate: 0.15, latencyMs: 1000 };

function packets(site: Site, samples: TrueSample[], tag: string, seed: number, noise: NoiseModel): RawRow[] {
  const r = rng(seed); const rows: RawRow[] = [];
  let stillFor = 0, nextBlink = samples[0]?.t ?? 0, outsideRun = 0, id = seed * 1_000_000;
  const emit = (t: number, p: P, motion: "moving" | "stationary" = "moving") => {
    const at = t + noise.latencyMs + Math.floor(r.next() * 200);
    rows.push({ id: String(++id), tag_code: tag, x: p.x, y: p.y, created_at: new Date(at).toISOString(), received_at: new Date(at + 5).toISOString(),
      quality: null, map_id: site.name, zone_id: null, zone_name: null, pdop: null, ...(SEND_MOTION ? { motion } : {}) });
  };
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.inject) { for (const p of s.inject) emit(s.t, p, stillFor >= 30_000 ? "stationary" : "moving"); continue; }
    // Firmware: stationary → moving transition requests one immediate blink, then 10 Hz.
    if (s.moving && stillFor >= 30_000) nextBlink = s.t;
    stillFor = s.moving ? 0 : stillFor + 100;
    if (s.t < nextBlink) continue;
    nextBlink = s.t + (stillFor >= 30_000 ? 10_000 : 100);
    if (s.silent) continue;
    const roomId = truthPlace(site, s.p);
    const outsideArea = site.config.largeAreas.length > 0 && !site.config.largeAreas.some(a => inPoly(s.p, a.polygon));
    let recv = noise.corridorRecv;
    if (roomId) {
      const d = door(site, roomId), depth = Math.hypot(s.p.x - d.x, s.p.y - d.y);
      recv = site.leakyRooms.has(roomId) ? noise.corridorRecv * 0.8 : noise.corridorRecv * Math.exp(-depth / noise.roomDecayM);
    } else if (outsideArea) {
      const gateDistance = Math.min(...site.config.largeAreas.flatMap(a => a.gates.map(g => Math.min(...g.polygon.map(q => Math.hypot(q.x - s.p.x, q.y - s.p.y))))));
      recv = gateDistance < 2 ? noise.corridorRecv * 0.5 : 0;
    } else if (site.holes.some(h => inPoly(s.p, h.poly))) recv = 0;
    if (r.next() > recv) continue;
    // Jetson solver output
    let m: P = { x: s.p.x + r.normal() * noise.sigma, y: s.p.y + r.normal() * noise.sigma };
    const truthOutsideZone = !inPoly(s.p, site.zone);
    if (truthOutsideZone) {
      outsideRun++;
      const nlos = { x: s.p.x + r.normal() * 0.8, y: s.p.y + r.normal() * 0.8 };
      if (roomId && r.next() < noise.neighborShiftRate) {
        const dd = door(site, roomId), n = dd.inwardNormal!, t = { x: -n.y, y: n.x }, sign = r.next() < 0.5 ? -1 : 1;
        nlos.x += t.x * 2.0 * sign; nlos.y += t.y * 2.0 * sign;
      }
      // in-preference clamp until four consecutive outside samples confirm the exit
      m = outsideRun >= 4 ? nlos : project(nlos, site.zone);
      m = { x: m.x + r.normal() * 0.1, y: m.y + r.normal() * 0.1 };
    } else outsideRun = 0;
    if (r.next() < noise.spikeRate) { const a = r.next() * Math.PI * 2, d = 1.5 + r.next() * 4.5; m = { x: m.x + Math.cos(a) * d, y: m.y + Math.sin(a) * d }; }
    emit(s.t, m, stillFor >= 30_000 ? "stationary" : "moving");
  }
  return rows;
}

function truthFor(site: Site, samples: TrueSample[], name: string, latencyMs: number): Truth {
  const visits: Truth["visits"] = []; let current = null as { roomId: string; from: number } | null;
  for (const s of samples) {
    const roomId = truthPlace(site, s.p);
    if (roomId !== current?.roomId) {
      if (current) visits.push({ roomId: current.roomId, from: new Date(current.from + latencyMs).toISOString(), to: new Date(s.t + latencyMs).toISOString() });
      current = roomId ? { roomId, from: s.t } : null;
    }
  }
  const end = samples.at(-1)!.t;
  if (current) visits.push({ roomId: current.roomId, from: new Date(current.from + latencyMs).toISOString(), to: new Date(end + latencyMs).toISOString() });
  return { testId: name, timezone: "Europe/Istanbul", revision: 1, revisionReason: "simülasyon", visits,
    test: { from: new Date(samples[0].t + 20_000).toISOString(), to: new Date(end + latencyMs).toISOString() },
    groups: [{ id: "sim", tagCodes: ["SIM-TAG"] }] };
}

// ------------------------------------------------------------ scenarios
const T0 = Date.parse("2026-10-14T08:00:00.000Z");
const servis = loadSite("necmettin-servis", "servis", ["room-01"], [[{ x: -0.05, y: 28 }, { x: 3.6, y: 28 }, { x: 3.6, y: 31 }, { x: -0.05, y: 31 }]]);
const icu = loadSite("necmettin-yogun-bakim", "neuyogun");

function enterRoom(site: Site, id: string, dwell: number, depth = 2.5): Leg[] {
  return [{ walk: doorFront(site, id, 0.8) }, { walk: roomInside(site, id, 0.6) , speed: 0.8 }, { walk: roomInside(site, id, depth), speed: 0.8 },
    { dwell }, { walk: roomInside(site, id, 0.6), speed: 0.8 }, { walk: doorFront(site, id, 0.9), speed: 0.8 }];
}
interface Scenario { name: string; description: string; site: Site; route: Route }
const scenarios: Scenario[] = [
  { name: "S1-kapida-kopma", description: "Tag odaya girerken kapıda verisi kesiliyor, 70 sn içeride kalıyor, çıkıyor (saha #1)", site: servis,
    route: { start: { x: 1.8, y: 10 }, legs: [{ walk: { x: 1.8, y: 22 } }, ...enterRoom(servis, "room-07", 70_000), { walk: { x: 1.8, y: 36 } }, { dwell: 15_000 }] } },
  { name: "S2-komsu-oda-sicramasi", description: "202'ye giriyor; girişte 2 ölçüm 201 içine düşüyor, sonra sessizlik (saha #2)", site: servis,
    route: { start: { x: 1.8, y: 20 }, legs: [{ walk: doorFront(servis, "room-03", 0.8) }, { walk: roomInside(servis, "room-03", 0.6), speed: 0.8 },
      { inject: [roomInside(servis, "room-02", 0.7, 0.5), roomInside(servis, "room-02", 0.9, 0.4)] },
      { walk: roomInside(servis, "room-03", 3), speed: 0.8 }, { dwell: 60_000 }, { walk: roomInside(servis, "room-03", 0.6), speed: 0.8 },
      { walk: doorFront(servis, "room-03", 1.0), speed: 0.8 }, { walk: { x: 1.8, y: 20 } }, { dwell: 10_000 }] } },
  { name: "S3-cikis-kapisi", description: "Koridor sonundaki çıkış kapısından alandan çıkıyor; Dr Odası kapısının yanından geçiyor (saha #3)", site: servis,
    route: { start: { x: 1.8, y: 15 }, legs: [{ walk: { x: 1.4, y: 1.5 } }, { walk: { x: 0.9, y: -0.2 } }, { walk: { x: 0.8, y: -4 } }, { walk: { x: 0.8, y: -25 } }, { dwell: 90_000 }] } },
  { name: "S4-oda-onunde-kopma", description: "202 kapısının 1,2 m yanında son koridor verisi; sonra hiç veri yok, tag odada (saha #4)", site: servis,
    route: { start: { x: 1.8, y: 20 }, legs: [{ walk: doorFront(servis, "room-03", 0.9, 1.2) },
      { walk: doorFront(servis, "room-03", 0.6), silent: true }, { walk: roomInside(servis, "room-03", 3), speed: 0.8, silent: true }, { silence: 80_000 },
      { walk: roomInside(servis, "room-03", 0.5), speed: 0.8 }, { walk: doorFront(servis, "room-03", 1.0), speed: 0.8 }, { walk: { x: 1.8, y: 25 } }] } },
  { name: "S5-koridorda-hareketsiz", description: "Koridor ortasında 3 dk hareketsiz (10 sn blink); oda atanmamalı", site: servis,
    route: { start: { x: 1.8, y: 30 }, legs: [{ walk: { x: 1.8, y: 19.5 } }, { dwell: 180_000, still: true }, { walk: { x: 1.8, y: 36 } }] } },
  { name: "S6-kapilarin-onunden-gecis", description: "Koridorun tamamı boyunca tüm kapıların önünden geçiyor; oda atanmamalı", site: servis,
    route: { start: { x: 1.0, y: 1.5 }, legs: [{ walk: { x: 0.8, y: 40 } }, { walk: { x: 2.6, y: 40 } }, { walk: { x: 2.6, y: 1.5 } }, { dwell: 5000 }] } },
  { name: "S7-sizdiran-oda", description: "Dr Odası gibi içeriden sürekli veri gelen oda; 60 sn", site: servis,
    route: { start: { x: 1.8, y: 12 }, legs: [...enterRoom(servis, "room-01", 60_000, 1.6), { walk: { x: 1.8, y: 12 } }] } },
  { name: "S8-kapsama-boslugu", description: "Kapılardan uzak kapsama boşluğu (y 28–31) içinden geçiş", site: servis,
    route: { start: { x: 1.8, y: 22 }, legs: [{ walk: { x: 1.8, y: 36 }, speed: 0.5 }, { dwell: 5000 }] } },
  { name: "S9-sizdiran-odada-hareketsiz", description: "Dr Odası'na girip 4 dk hareketsiz (10 sn blink, veri koridora da düşer); oda korunmalı", site: servis,
    route: { start: { x: 1.8, y: 12 }, legs: [{ walk: doorFront(servis, "room-01", 0.8) }, { walk: roomInside(servis, "room-01", 1.6), speed: 0.8 },
      { dwell: 240_000, still: true }, { walk: doorFront(servis, "room-01", 0.9), speed: 0.8 }, { walk: { x: 1.8, y: 12 } }, { dwell: 5000 }] } },
  { name: "S10-kapi-onunde-hareketsiz", description: "Oda 7 kapısının hemen önünde (koridorda) 3 dk hareketsiz; oda atanmamalı", site: servis,
    route: { start: { x: 1.8, y: 30 }, legs: [{ walk: doorFront(servis, "room-07", 0.7) }, { dwell: 180_000, still: true }, { walk: { x: 1.8, y: 36 } }, { dwell: 5000 }] } },
  { name: "Y1-yogun-bakim-oda7", description: "Yoğun bakım Oda 7: kapıda kopma ve 60 sn içeride (saha #1, yoğun bakım)", site: icu,
    route: { start: { x: 1.8, y: 12 }, legs: [...enterRoom(icu, "room-07", 60_000), { walk: { x: 1.8, y: 12 } }, { dwell: 5000 }] } },
  { name: "Y2-yogun-bakim-cikis", description: "Yoğun bakım sol çıkış kapısından çıkış; Oda 7 kapısının yanından", site: icu,
    route: { start: { x: 1.8, y: 10 }, legs: [{ walk: { x: 2.0, y: 1.0 } }, { walk: { x: 2.2, y: -0.5 } }, { walk: { x: 2.2, y: -10 } }, { dwell: 90_000 }] } },
];

// Real Servis test route (truth test-5c71fd2a, 17 room visits) replayed on the simulator
function realRoute(site: Site, truthFile: string): Scenario {
  const truth = JSON.parse(readFileSync(truthFile, "utf8")) as Truth;
  const legs: Leg[] = []; let previousEnd = Date.parse(truth.test.from);
  for (const visit of truth.visits) {
    const from = Date.parse(visit.from), to = Date.parse(visit.to);
    const corridor = Math.max(4000, from - previousEnd);
    legs.push({ walk: doorFront(site, visit.roomId, 0.9), speed: Math.max(0.6, Math.min(1.4, 10 / (corridor / 1000))) });
    legs.push({ walk: roomInside(site, visit.roomId, 0.6), speed: 0.8 }, { walk: roomInside(site, visit.roomId, 2.5), speed: 0.8 });
    legs.push({ dwell: Math.max(2000, to - from - 6000) }, { walk: roomInside(site, visit.roomId, 0.6), speed: 0.8 }, { walk: doorFront(site, visit.roomId, 0.9), speed: 0.8 });
    previousEnd = to;
  }
  return { name: `R-${path.basename(path.dirname(truthFile)).slice(0, 13)}`, description: `Gerçek test rotası (${truth.visits.length} oda ziyareti) simülasyonda`, site,
    route: { start: { x: 1.8, y: 20 }, legs: [{ dwell: 3000 }, ...legs, { walk: { x: 1.8, y: 20 } }, { dwell: 10_000 }] } };
}
const truthDir = path.resolve("tools/room-benchmark/datasets");
for (const id of ["test-5c71fd2a-af35-40d8-ba88-ade771f2c493", "test-9a7debf0-57ad-4df2-802b-ae92e4c20b13", "test-ce530aaa-a117-4075-8191-7169508dec93"])
  scenarios.push(realRoute(servis, path.join(truthDir, id, "truth.json")));

// ------------------------------------------------------------ run
const engines: Record<string, ReplayEngineFactory> = {
  "eski(room-evidence-10)": (publish, interval, now) => new RegionPositionEngine(publish, interval, now, false),
  "yeni(room-hmm-2)": (publish, interval, now) => new RoomHmmEngine(publish, interval, now, false),
};
const args = process.argv.slice(2);
const seeds = Number(args[args.indexOf("--seeds") + 1] ?? 10) || 10;
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const noise: NoiseModel = { ...DEFAULT_NOISE,
  ...(args.includes("--recv") ? { corridorRecv: Number(args[args.indexOf("--recv") + 1]) } : {}),
  ...(args.includes("--spike") ? { spikeRate: Number(args[args.indexOf("--spike") + 1]) } : {}),
  ...(args.includes("--sigma") ? { sigma: Number(args[args.indexOf("--sigma") + 1]) } : {}) };
const results: Record<string, Record<string, Record<string, number>>> = {};
for (const scenario of scenarios) {
  if (only && !scenario.name.startsWith(only)) continue;
  results[scenario.name] = {};
  for (const [engineName, factory] of Object.entries(engines)) {
    const total = { roomMs: 0, correctRoomMs: 0, wrongRoomMs: 0, corridorFalseRoomMs: 0, corridorMs: 0, corridorOkMs: 0, lostRoomMs: 0, visits: 0, missed: 0, entryDelay: 0, exitDelay: 0, exitN: 0 };
    for (let seed = 1; seed <= seeds; seed++) {
      const samples = sampleRoute(scenario.route, T0);
      const rows = packets(scenario.site, samples, "SIM-TAG", seed * 7919 + scenario.name.length, noise);
      const truth = truthFor(scenario.site, samples, scenario.name, DEFAULT_NOISE.latencyMs);
      const probes: string[] = [];
      const traced: ReplayEngineFactory = (publish, interval, now) => factory(position => { publish(position);
        const message = position.decisionTrace?.reasons.find(r => r.message.startsWith("Olasılıklar"))?.message ?? "";
        probes.push(message.replace("Olasılıklar: ", "")); }, interval, now);
      const result = replayRows(rows, truth, scenario.site.config, { tickMs: 1000, sampleMs: 250, boundaryToleranceMs: 2000, warmupMs: 20_000, observationMs: 30_000, pdopEnabled: false }, traced);
      const m = result.metrics, tag = m.tags["SIM-TAG"];
      if (args.includes("--falsecorr") && seed === 1 && engineName.startsWith("yeni")) {
        const ev = result.decisions; let i = 0, cur: (typeof ev)[number] | undefined; let open: number | null = null; let label = "";
        const from = Date.parse(truth.test.from), to = Date.parse(truth.test.to);
        for (let t = from; t < to; t += 250) {
          while (i < ev.length && Date.parse(ev[i].at) <= t) cur = ev[i++];
          const visit = truth.visits.find(v => Date.parse(v.from) <= t && t < Date.parse(v.to));
          const predicted = cur && ["IN_REGION", "INFERRED_IN_REGION", "EXIT_CANDIDATE"].includes(cur.state) ? cur.roomId : null;
          const bad = !visit && predicted;
          if (bad && open === null) { open = t; const prev = truth.visits.filter(v => Date.parse(v.to) <= t).at(-1); const next = truth.visits.find(v => Date.parse(v.from) > t);
            label = `${predicted} | önceki ${prev?.roomId}@${prev ? ((t - Date.parse(prev.to)) / 1000).toFixed(1) : "-"}s sonra, sonraki ${next?.roomId}@${next ? ((Date.parse(next.from) - t) / 1000).toFixed(1) : "-"}s önce`; }
          if (!bad && open !== null) { console.log(`   koridordaOda ${((t - open) / 1000).toFixed(1)}s  ${label}`); open = null; }
        }
      }
      if (args.includes("--trace") && seed === Number(args[args.indexOf("--trace") + 1]) && engineName.startsWith(args[args.indexOf("--trace") + 2] ?? "yeni")) {
        for (const v of truth.visits) console.log(`   TRUTH ${v.roomId} ${v.from.slice(14, 21)} → ${v.to.slice(14, 21)}`);
        let last = "";
        for (const [index, d] of result.decisions.entries()) {
          const key = `${d.state}|${d.roomId}|${d.synthetic ? "" : d.input.x.toFixed(1) + "," + d.input.y.toFixed(1)}`;
          if (key === last && d.synthetic) continue; last = key;
          const probs = " | " + (probes[index] ?? "");
          console.log(`   ${d.at.slice(14, 21)} ${d.synthetic ? "tick" : "meas"} (${d.input.x.toFixed(2)},${d.input.y.toFixed(2)}) ${d.state} ${d.roomId ?? "-"} ${d.eventType} ${d.reasonCodes.join("/")}${probs}`);
        }
      }
      const rooms = Object.values(tag.rooms).reduce((sum, c) => ({ total: sum.total + c.totalMs, ok: sum.ok + c.correctConfirmedMs + c.correctInferredMs, wrong: sum.wrong + c.wrongRoomMs, lost: sum.lost + c.lostOrUncertainMs }), { total: 0, ok: 0, wrong: 0, lost: 0 });
      total.roomMs += rooms.total; total.correctRoomMs += rooms.ok; total.wrongRoomMs += rooms.wrong; total.lostRoomMs += rooms.lost;
      const corridorMs = tag.strict.totalMs - rooms.total;
      total.corridorMs += corridorMs; total.corridorFalseRoomMs += tag.strict.corridorFalseRoomMs; total.corridorOkMs += tag.strict.outsideCorrectMs;
      for (const visit of tag.visits as { missed: boolean; entryDelayMs: number | null; exitDelayMs: number | null }[]) {
        total.visits++; if (visit.missed) total.missed++; else total.entryDelay += visit.entryDelayMs ?? 0;
        if (visit.exitDelayMs !== null) { total.exitDelay += visit.exitDelayMs; total.exitN++; }
      }
    }
    const pct = (a: number, b: number) => b ? Math.round(1000 * a / b) / 10 : NaN;
    results[scenario.name][engineName] = {
      dogruOdaYuzde: pct(total.correctRoomMs, total.roomMs), yanlisOdaYuzde: pct(total.wrongRoomMs, total.roomMs), belirsizOdaYuzde: pct(total.lostRoomMs, total.roomMs),
      koridordaOdaYuzde: pct(total.corridorFalseRoomMs, total.corridorMs), koridorDogruYuzde: pct(total.corridorOkMs, total.corridorMs),
      kacanZiyaret: total.missed, ziyaret: total.visits,
      ortGirisGecikmesiSn: Math.round((total.entryDelay / Math.max(1, total.visits - total.missed)) / 100) / 10,
      ortCikisGecikmesiSn: Math.round((total.exitDelay / Math.max(1, total.exitN)) / 100) / 10,
    };
  }
  console.log(`== ${scenario.name}: ${scenario.description}`);
  for (const [engineName, r] of Object.entries(results[scenario.name]))
    console.log(`   ${engineName.padEnd(24)} doğruOda %${r.dogruOdaYuzde} yanlışOda %${r.yanlisOdaYuzde} belirsiz %${r.belirsizOdaYuzde} | koridordaOda %${r.koridordaOdaYuzde} koridorDoğru %${r.koridorDogruYuzde} | kaçan ${r.kacanZiyaret}/${r.ziyaret} giriş ${r.ortGirisGecikmesiSn}s çıkış ${r.ortCikisGecikmesiSn}s`);
}
if (args.includes("--json")) writeFileSync(args[args.indexOf("--json") + 1], JSON.stringify({ seeds, noise, scenarios: scenarios.map(s => ({ name: s.name, description: s.description, site: s.site.name })), results }, null, 2));
