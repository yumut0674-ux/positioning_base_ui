/**
 * Gerçek Jetson positions.jsonl kaydını (UI'ye gönderilen akış) truth.json ile iki motorda puanlar.
 *
 * node --import tsx tools/room-benchmark/field-sim/scoreJetsonLog.ts <positions.jsonl> <truth.json> [--map necmettin-servis] [--zone servis]
 *   [--offset-ms 0] [--latency-ms 0] [--no-motion] [--no-solver-raw] [--raw] [--json out.json] [--trace yeni]
 *
 * Satırın ölçüm zamanı Jetson `updated_at`; UI'ye teslim zamanı updated_at + latency.
 * `motion` alanı (0 hareketli, 1 hareketsiz) motora iletilir (--no-motion ile kapatılır).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compileRegionsConfig } from "../../../src/server/regionEngine/configLoader";
import { RegionPositionEngine } from "../../../src/server/regionEngine/RegionPositionEngine";
import { RoomHmmEngine } from "../../../src/server/regionEngine/RoomHmmEngine";
import type { RegionsConfig } from "../../../src/features/regions/types/region.types";
import { replayRows, type ReplayEngineFactory } from "../replay";
import type { RawRow, Truth } from "../model";

const args = process.argv.slice(2);
const opt = (key: string, fallback?: string) => { const i = args.indexOf(`--${key}`); return i < 0 ? fallback : args[i + 1]; };
const [positionsFile, truthFile] = args;
const mapId = opt("map", "necmettin-servis")!, zone = opt("zone", mapId === "necmettin-servis" ? "servis" : "neuyogun")!;
const offsetMs = Number(opt("offset-ms", "0")), latencyMs = Number(opt("latency-ms", "0"));
const useMotion = !args.includes("--no-motion");
const minAnchors = Number(opt("min-anchors", "0")), minReceived = Number(opt("min-received", "0"));
// --raw: use the solver's unclamped position (raw_x/raw_y) instead of the zone-clamped x/y.
const useRaw = args.includes("--raw");
// raw_x/raw_y/raw_inside are passed to the new engine as `solverRaw` like the live ingest does (--no-solver-raw disables).
const useSolverRaw = !args.includes("--no-solver-raw");
const hmmOverrides = opt("hmm") ? JSON.parse(opt("hmm")!) : undefined;
// --confusion room-confusion.json: learned room confusion table (learnConfusion.ts); "none" disables the map's own file.
const confusionArg = opt("confusion");
const confusionFile = confusionArg ?? path.resolve("config/maps", opt("map", "necmettin-servis")!, "room-confusion.json");
// --emission room-emission.json: learned emission correction (learnEmission.ts); "none" disables the map's own file.
const emissionArg = opt("emission");
const emissionFile = emissionArg ?? path.resolve("config/maps", opt("map", "necmettin-servis")!, "room-emission.json");
const emission = emissionArg === "none" ? null : (() => { try { return JSON.parse(readFileSync(emissionFile, "utf8")); } catch { return null; } })();
const confusion = confusionArg === "none" ? null : (() => { try { return JSON.parse(readFileSync(confusionFile, "utf8")); } catch { return null; } })();
const config = compileRegionsConfig(JSON.parse(readFileSync(path.resolve("config/maps", mapId, "regions.json"), "utf8")) as RegionsConfig);
const truth = JSON.parse(readFileSync(truthFile, "utf8")) as Truth;
const tags = new Set(truth.groups.flatMap(g => g.tagCodes));
const from = Date.parse(truth.test.from) - 60_000, to = Date.parse(truth.test.to) + 90_000;

let id = 0;
const rows: (RawRow & { solverRaw?: { x: number; y: number } | null; anchorCount?: number | null })[] = [];
for (const line of readFileSync(positionsFile, "utf8").split("\n")) {
  if (!line) continue;
  // Python writes non-standard Infinity/NaN for degenerate geometry; read them as unknown.
  const r = JSON.parse(line.replace(/:\s*(-?Infinity|NaN)/g, ":null")) as Record<string, unknown>;
  const tag = String(r.uid).toUpperCase();
  // --min-anchors N: drop solutions with fewer inlier anchors (3-anchor TDoA has a mirror solution).
  if (minAnchors && Array.isArray(r.inlier_anchors) && r.inlier_anchors.length < minAnchors) continue;
  // --min-received N: what Jetson solver.minAnchors=N would have dropped (received, before outlier removal).
  if (minReceived && typeof r.received_anchor_count === "number" && r.received_anchor_count < minReceived) continue;
  if (!tags.has(tag)) continue;
  const at = Number(r.updated_at) * 1000 + offsetMs;
  if (at < from || at > to) continue;
  const onMap = r.zone_id === zone;
  const hasRaw = r.raw_x != null && r.raw_y != null && Number.isFinite(Number(r.raw_x)) && Number.isFinite(Number(r.raw_y));
  const raw = hasRaw && useRaw;
  rows.push({ id: String(++id), tag_code: tag, x: Number(raw ? r.raw_x : r.x), y: Number(raw ? r.raw_y : r.y), created_at: new Date(at).toISOString(),
    received_at: new Date(at + latencyMs).toISOString(), quality: null, map_id: onMap ? mapId : `other:${String(r.zone_id)}`,
    zone_id: String(r.zone_id), zone_name: String(r.zone_name ?? ""),
    pdop: typeof r.geometry_pdop === "number" && Number.isFinite(r.geometry_pdop) ? r.geometry_pdop : null,
    motion: useMotion && (r.motion === 0 || r.motion === 1) ? (r.motion === 1 ? "stationary" : "moving") : null,
    solverRaw: useSolverRaw && hasRaw && r.raw_inside === false ? { x: Number(r.raw_x), y: Number(r.raw_y) } : null,
    anchorCount: args.includes("--no-anchors") ? null : Array.isArray(r.inlier_anchors) ? r.inlier_anchors.length : typeof r.inlier_anchor_count === "number" ? r.inlier_anchor_count : null });
}
// Rows from the other floor's zone do not reach this map's engine (the controller routes by map).
const mapRows = rows.filter(r => r.map_id === mapId);
const extraByRow = new Map(mapRows.map(r => [r.created_at + r.tag_code, { motion: r.motion ?? null, solverRaw: r.solverRaw ?? null, anchorCount: r.anchorCount ?? null }]));

// The old engine gets motion through replayRows too, but ignores it; only the new one reads solverRaw.
const withMotion = (factory: ReplayEngineFactory): ReplayEngineFactory => (publish, interval, now) => {
  const engine = factory(publish, interval, now);
  return { enable: c => engine.enable(c), tick: () => engine.tick(), disable: () => engine.disable(),
    ingest: p => engine.ingest({ ...p, ...extraByRow.get(p.timestamp + p.tagCode) }) };
};
const engines: Record<string, ReplayEngineFactory> = {
  "eski(room-evidence-10)": (publish, interval, now) => new RegionPositionEngine(publish, interval, now, false),
  "yeni(room-hmm)": withMotion((publish, interval, now) => {
    const engine = new RoomHmmEngine(publish, interval, now, false, hmmOverrides);
    if (confusion) engine.setRoomConfusion(confusion);
    if (emission) engine.setEmissionCorrection(emission);
    return engine;
  }),
};
const out: Record<string, unknown> = {};
const name = (id: string | null) => id ? config.regions.find(r => r.id === id)?.name ?? id : "-";
console.log(`${truth.testId}: ${mapRows.length} satır (${rows.length - mapRows.length} başka bölge), ${truth.visits.length} ziyaret, tag ${[...tags].join(",")}`);
for (const [engineName, factory] of Object.entries(engines)) {
  const result = replayRows(mapRows, truth, config, { tickMs: 1000, sampleMs: 250, boundaryToleranceMs: 2000, warmupMs: 60_000, observationMs: 60_000, pdopEnabled: true, pdopMax: 20 }, factory);
  const m = result.metrics;
  const visits = Object.values(m.tags).flatMap(t => t.visits as { roomId: string; missed: boolean; entryDelayMs: number | null; exitDelayMs: number | null }[]);
  const rooms = Object.values(m.tags).reduce((s, t) => { for (const c of Object.values(t.rooms)) { s.total += c.totalMs; s.ok += c.correctConfirmedMs + c.correctInferredMs; s.wrong += c.wrongRoomMs; } return s; }, { total: 0, ok: 0, wrong: 0 });
  const strict = m.summary, corridorMs = strict.totalMs - rooms.total;
  const tolerant = Object.values(m.tags).reduce((s, t) => { for (const c of Object.values(t.roomsTolerant)) { s.total += c.totalMs; s.ok += c.correctConfirmedMs + c.correctInferredMs; } return s; }, { total: 0, ok: 0 });
  const pct = (a: number, b: number) => b ? Math.round(1000 * a / b) / 10 : NaN;
  const caught = visits.filter(v => !v.missed);
  const summary = {
    yakalanan: `${caught.length}/${visits.length}`, dogruOda: pct(rooms.ok, rooms.total), dogruOdaToleransli: pct(tolerant.ok, tolerant.total), yanlisOda: pct(rooms.wrong, rooms.total),
    koridordaOda: pct(strict.corridorFalseRoomMs, corridorMs), koridorDogru: pct(strict.outsideCorrectMs, corridorMs), genelBasari: m.successPercent,
    ortGirisSn: caught.length ? Math.round(caught.reduce((s, v) => s + (v.entryDelayMs ?? 0), 0) / caught.length / 100) / 10 : null,
  };
  // Jump metrics: room→room switches with ≤3 s outside any room, and short (<6 s) room blips that
  // overlap no truth visit of that room ("pik"). Both are what the field sees as sudden jumps.
  const segs: { room: string; from: number; to: number }[] = [];
  for (const d of result.decisions) {
    const at = Date.parse(d.at), room = d.roomId;
    const last = segs.at(-1);
    if (last && last.room === room) { last.to = at; continue; }
    if (last) last.to = at;
    if (room) segs.push({ room, from: at, to: at });
    else if (last) segs.push({ room: "", from: at, to: at });
  }
  const roomSegs = segs.filter(x => x.room);
  const overlaps = (x: { room: string; from: number; to: number }) => truth.visits.some(v => v.roomId === x.room && Date.parse(v.from) - 3000 < x.to && Date.parse(v.to) + 3000 > x.from);
  let roomJumps = 0, wrongJumps = 0;
  for (let i = 1; i < roomSegs.length; i++) if (roomSegs[i].room !== roomSegs[i - 1].room && roomSegs[i].from - roomSegs[i - 1].to <= 3000) { roomJumps++; if (!overlaps(roomSegs[i])) wrongJumps++; }
  const blipList = roomSegs.filter(x => x.to - x.from < 6000 && !overlaps(x)), blips = blipList.length;
  if (args.includes("--blips") && engineName.startsWith("yeni")) for (const x of blipList) {
    const ds = result.decisions.filter(d => Date.parse(d.at) >= x.from && Date.parse(d.at) <= x.to && d.roomId === x.room);
    console.log(`    PİK ${new Date(x.from).toISOString().slice(11, 21)} ${name(x.room)} ${Math.round((x.to - x.from) / 100) / 10}s states=${[...new Set(ds.map(d => d.state))].join(",")} giriş=(${ds[0]?.input.x.toFixed(1)},${ds[0]?.input.y.toFixed(1)})`);
  }
  Object.assign(summary, { odaOdaAtlama: roomJumps, yanlisAtlama: wrongJumps, yanlisPik: blips, odaSegment: roomSegs.length });
  out[engineName] = { summary, visits: visits.map(v => ({ room: v.roomId, missed: v.missed, entryDelayMs: v.entryDelayMs, exitDelayMs: v.exitDelayMs })) };
  console.log(`  ${engineName.padEnd(24)} yakalanan ${summary.yakalanan}  doğruOda %${summary.dogruOda} (tol %${summary.dogruOdaToleransli})  yanlışOda %${summary.yanlisOda}  koridordaOda %${summary.koridordaOda}  koridorDoğru %${summary.koridorDogru}  giriş ${summary.ortGirisSn}s  atlama ${roomJumps} (yanlış ${wrongJumps})  yanlışPik ${blips}`);
  if (args.includes("--per-visit") && engineName.startsWith("yeni")) for (const v of truth.visits) {
    const f = Date.parse(v.from), t = Date.parse(v.to), share: Record<string, number> = {};
    let prev: { at: number; label: string } | null = null;
    for (const d of result.decisions) {
      const at = Date.parse(d.at), label = d.roomId ? name(d.roomId) : "koridor";
      if (prev && at > f && prev.at < t) share[prev.label] = (share[prev.label] ?? 0) + Math.min(at, t) - Math.max(prev.at, f);
      prev = { at, label };
    }
    const total = Object.values(share).reduce((a, b) => a + b, 0) || 1;
    console.log(`    ${v.from.slice(11, 19)} ${name(v.roomId).padEnd(5)} ${Math.round((t - f) / 1000)}s → ` + Object.entries(share).sort((a, b) => b[1] - a[1]).map(([k, ms]) => `${k} %${Math.round(100 * ms / total)}`).join(", "));
  }
  if (args.includes("--gaps") && engineName.startsWith(opt("gaps-engine", "yeni")!)) {
    // Corridor periods between visits (incl. the door-front wait before each entry).
    const vs = truth.visits.map(v => ({ ...v, f: Date.parse(v.from), t: Date.parse(v.to) }));
    for (let i = 0; i < vs.length; i++) {
      const f = i ? vs[i - 1].t : Date.parse(truth.test.from), t = vs[i].f, share: Record<string, number> = {};
      let prev: { at: number; label: string } | null = null;
      for (const d of result.decisions) { const at = Date.parse(d.at), label = d.roomId ? name(d.roomId) : "koridor";
        if (prev && at > f && prev.at < t) share[prev.label] = (share[prev.label] ?? 0) + Math.min(at, t) - Math.max(prev.at, f); prev = { at, label }; }
      const total = Object.values(share).reduce((a, b) => a + b, 0) || 1;
      console.log(`    KORİDOR ${new Date(f).toISOString().slice(11, 19)}–${new Date(t).toISOString().slice(11, 19)} (${Math.round((t - f) / 1000)}s, sonra ${name(vs[i].roomId)}) → ` + Object.entries(share).sort((a, b) => b[1] - a[1]).map(([k, ms]) => `${k} ${Math.round(ms / 1000)}s`).join(", "));
    }
  }
  if (opt("trace") && engineName.startsWith(opt("trace")!)) {
    let last = "";
    for (const d of result.decisions) {
      const label = ["IN_REGION", "INFERRED_IN_REGION", "EXIT_CANDIDATE"].includes(d.state) ? name(d.roomId) + (d.state === "IN_REGION" ? "" : "~") : d.state === "LOCATION_LOST" ? "?" : "koridor";
      if (label !== last) { console.log(`    ${d.at.slice(11, 21)} ${label}  (${d.input.x.toFixed(1)},${d.input.y.toFixed(1)})`); last = label; }
    }
    for (const v of truth.visits) console.log(`    TRUTH ${v.from.slice(11, 21)}–${v.to.slice(11, 21)} ${name(v.roomId)}`);
  }
}
if (opt("json")) writeFileSync(opt("json")!, JSON.stringify(out, null, 2));
