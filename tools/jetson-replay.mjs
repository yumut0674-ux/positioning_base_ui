#!/usr/bin/env node
/**
 * Jetson kaydını (positions.jsonl) çalışan arayüze canlı veri gibi gönderir.
 * Jetson olmadan bilgisayarda test etmek içindir. Ek paket gerekmez.
 *
 *   node tools/jetson-replay.mjs <positions.jsonl> [--url http://127.0.0.1:3000/api/tracking/ingest]
 *        [--speed 1] [--from 15:14:00] [--to 15:20:00] [--tag EC27]
 *
 * Zaman damgaları "şimdi"ye kaydırılır; paketler kayıttaki aralıklarla (speed ile hızlandırılarak) gönderilir.
 * --from/--to kayıttaki yerel saattir (Türkiye saati).
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const file = args[0] && !args[0].startsWith("--") ? args[0] : null;
if (!file) {
  console.log("Kullanım: node tools/jetson-replay.mjs <positions.jsonl> [--speed 1] [--from SS:DD:ss] [--to SS:DD:ss] [--tag UID] [--url ...]");
  process.exit(1);
}
const url = opt("url", "http://127.0.0.1:3000/api/tracking/ingest");
const speed = Number(opt("speed", "1"));
const onlyTag = opt("tag", null)?.toUpperCase() ?? null;
const istanbulClock = (seconds) => new Date(seconds * 1000 + 3 * 3_600_000).toISOString().slice(11, 19);
const from = opt("from", null), to = opt("to", null);

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const rows = [];
for await (const line of createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  // Python Infinity/NaN are not JSON.
  const r = JSON.parse(line.replace(/:\s*(-?Infinity|NaN)/g, ":null"));
  if (r.calibration_tag) continue;
  if (onlyTag && !String(r.uid).toUpperCase().startsWith(onlyTag)) continue;
  const clock = istanbulClock(Number(r.updated_at));
  if ((from && clock < from) || (to && clock > to)) continue;
  rows.push(r);
}
rows.sort((a, b) => a.updated_at - b.updated_at);
if (!rows.length) { console.log("Gönderilecek satır yok (dosya / --from / --to / --tag kontrol edin)."); process.exit(1); }
const first = rows[0].updated_at, last = rows.at(-1).updated_at;
console.log(`${rows.length} konum, ${istanbulClock(first)}–${istanbulClock(last)} (${Math.round(last - first)} sn), hız x${speed} → ${url}`);

const start = Date.now();
let sent = 0, failed = 0;
const zoned = (ms) => { const d = new Date(ms + 3 * 3_600_000); return d.toISOString().replace("Z", "+03:00"); };
for (const r of rows) {
  const due = start + ((r.updated_at - first) * 1000) / speed;
  const wait = due - Date.now();
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  const body = {
    type: "position", tag_id: String(r.uid), x: Number(r.x), y: Number(r.y),
    zone_id: r.zone_id ?? null, zone_name: r.zone_name ?? null,
    pdop: finite(r.geometry_pdop ?? r.pdop),
    motion: r.motion === 0 || r.motion === 1 ? r.motion : null,
    motion_label: typeof r.motion_label === "string" ? r.motion_label : null,
    raw_x: finite(r.raw_x), raw_y: finite(r.raw_y),
    raw_inside: typeof r.raw_inside === "boolean" ? r.raw_inside : null,
    timestamp: zoned(Date.now()),
  };
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (response.status >= 400) { failed++; if (failed <= 5) console.log(`HATA ${response.status}: ${await response.text()}`); }
    else sent++;
  } catch (error) {
    failed++;
    if (failed <= 5) console.log(`Bağlanamadı: ${error.message} (arayüz çalışıyor mu? npm run dev)`);
  }
  if ((sent + failed) % 200 === 0) console.log(`  ${istanbulClock(r.updated_at)}  gönderilen ${sent}, hata ${failed}`);
}
console.log(`Bitti: gönderilen ${sent}, hata ${failed}`);
