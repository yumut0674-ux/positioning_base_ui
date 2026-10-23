/**
 * Jetson "positions.jsonl" kaydını (UI'ye gönderilen akışın aynısı) iki motorla oynatır.
 * Truth olmadığı için puan vermez; oda zaman çizelgesini yan yana yazar.
 *
 * node --import tsx tools/room-benchmark/field-sim/replayJetsonLog.ts <positions.jsonl> [--tag UID] [--zone servis] [--no-motion] [--quiet]
 *
 * Tagın "hareketsiz" bildirdiği dönemlerde (motion=1) kişi yer değiştirmemiştir; bu dönemlerde
 * gösterilen yerin kaç kez değiştiği "hareketsizken geçiş" olarak raporlanır (ideal 0).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { compileRegionsConfig } from "../../../src/server/regionEngine/configLoader";
import { RegionPositionEngine } from "../../../src/server/regionEngine/RegionPositionEngine";
import { RoomHmmEngine } from "../../../src/server/regionEngine/RoomHmmEngine";
import type { ProcessedPosition } from "../../../src/server/regionEngine/types";
import type { RegionsConfig } from "../../../src/features/regions/types/region.types";

const args = process.argv.slice(2);
const file = args[0];
const zone = args.includes("--zone") ? args[args.indexOf("--zone") + 1] : "servis";
const onlyTag = args.includes("--tag") ? args[args.indexOf("--tag") + 1] : null;
const useMotion = !args.includes("--no-motion"), quiet = args.includes("--quiet");
const mapId = zone === "servis" ? "necmettin-servis" : "necmettin-yogun-bakim";
const config = compileRegionsConfig(JSON.parse(readFileSync(path.resolve("config/maps", mapId, "regions.json"), "utf8")) as RegionsConfig);
const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line.replace(/:\s*(-?Infinity|NaN)/g, ":null")) as Record<string, unknown>)
  .filter(r => r.zone_id === zone && (!onlyTag || String(r.uid).startsWith(onlyTag)));
const tags = [...new Set(rows.map(r => String(r.uid)))];
const name = (id: string | null) => id ? (config.regions.find(r => r.id === id)?.name ?? id) : "-";

for (const tag of tags) {
  const tagRows = rows.filter(r => r.uid === tag).sort((a, b) => Number(a.updated_at) - Number(b.updated_at));
  const t0 = Number(tagRows[0].updated_at) * 1000, t1 = Number(tagRows.at(-1)!.updated_at) * 1000;
  const timelines: Record<string, { at: number; label: string }[]> = {};
  for (const engineName of ["eski", "yeni"]) {
    let clock = t0; const out: ProcessedPosition[] = [];
    const engine = engineName === "eski" ? new RegionPositionEngine(p => out.push(p), 1000, () => clock, false) : new RoomHmmEngine(p => out.push(p), 1000, () => clock, false);
    engine.enable(config);
    let tick = t0 + 1000;
    for (const r of tagRows) {
      const at = Number(r.updated_at) * 1000;
      while (tick <= at) { clock = tick; engine.tick(); tick += 1000; }
      clock = at;
      engine.ingest({ tagCode: tag, x: Number(r.x), y: Number(r.y), timestamp: new Date(at).toISOString(), receivedAt: new Date(at).toISOString(),
        pdop: typeof r.geometry_pdop === "number" && Number.isFinite(r.geometry_pdop) ? r.geometry_pdop : null, mapId,
        motion: useMotion && (r.motion === 0 || r.motion === 1) ? (r.motion === 1 ? "stationary" : "moving") : null });
    }
    while (tick <= t1 + 60_000) { clock = tick; engine.tick(); tick += 1000; }
    const line: { at: number; label: string }[] = [];
    for (const p of out) {
      const ri = p.regionInference;
      const label = ri.state === "IN_REGION" || ri.state === "INFERRED_IN_REGION" || ri.state === "EXIT_CANDIDATE" ? `${name(ri.regionId)}${ri.state === "IN_REGION" ? "" : "~"}`
        : ri.state === "LOCATION_LOST" ? "?" : ri.outsideArea ? "DIŞARI" : "koridor";
      const at = Date.parse(p.publishedAt!);
      if (line.at(-1)?.label !== label) line.push({ at, label });
    }
    timelines[engineName] = line;
    engine.disable();
  }
  // Stationary episodes reported by the tag: [first stationary sample, first moving sample).
  const episodes: [number, number][] = [];
  let start: number | null = null;
  for (const r of tagRows) {
    const at = Number(r.updated_at) * 1000;
    if (r.motion === 1 && start === null) start = at;
    if (r.motion !== 1 && start !== null) { episodes.push([start, at]); start = null; }
  }
  if (start !== null) episodes.push([start, t1]);
  console.log(`\n### ${tag}: ${tagRows.length} ölçüm, ${Math.round((t1 - t0) / 1000)} sn, hareketsiz dönem ${episodes.length} (${Math.round(episodes.reduce((a, [f, t]) => a + t - f, 0) / 1000)} sn)`);
  for (const [engineName, line] of Object.entries(timelines)) {
    const durations = new Map<string, number>();
    line.forEach((item, index) => { const end = line[index + 1]?.at ?? t1 + 60_000; durations.set(item.label, (durations.get(item.label) ?? 0) + end - item.at); });
    const stillItems = line.filter(item => episodes.some(([f, t]) => item.at > f + 2000 && item.at < t)), stillChanges = stillItems.length;
    if (args.includes("--still-detail")) console.log("   hareketsizken: " + stillItems.map(item => `${new Date(item.at).toISOString().slice(11, 19)}:${item.label}`).join(" "));
    console.log(`${engineName}: ${line.length} geçiş, hareketsizken geçiş ${stillChanges} | ` + [...durations].sort((a, b) => b[1] - a[1]).map(([l, ms]) => `${l} ${Math.round(ms / 1000)}s`).join(", "));
    if (!quiet) console.log("   " + line.map(item => `${Math.round((item.at - t0) / 1000)}s:${item.label}`).join(" → ").slice(0, 3000));
  }
}
