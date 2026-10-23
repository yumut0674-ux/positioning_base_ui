import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import { RoomHmmEngine, resolveRoomHmmSettings } from "../src/server/regionEngine/RoomHmmEngine";
import { readRoomEngineSelection } from "../src/server/regionEngine/roomEngineSelection";
import type { ProcessedPosition } from "../src/server/regionEngine/types";
import type { RegionsConfig } from "../src/features/regions/types/region.types";

type P = { x: number; y: number };
const load = (mapId: string) => compileRegionsConfig(JSON.parse(readFileSync(path.join("config/maps", mapId, "regions.json"), "utf8")) as RegionsConfig);
const servis = load("necmettin-servis"), icu = load("necmettin-yogun-bakim");
const T0 = Date.parse("2026-10-14T08:00:00.000Z");

/** Deterministic harness: 4 Hz packets with a fixed ±0.15 m zig-zag; ticks every second. */
function harness(config = servis) {
  let clock = T0; const out: ProcessedPosition[] = [];
  const engine = new RoomHmmEngine(p => out.push(p), 1000, () => clock, false);
  engine.enable(config);
  let nextTick = T0 + 1000, n = 0, motion: "moving" | "stationary" | null = null;
  const advance = (to: number) => { while (nextTick <= to) { clock = nextTick; engine.tick(); nextTick += 1000; } clock = to; };
  const packet = (p: P, tag = "T1") => { advance(clock); const j = (n++ % 2 ? 0.15 : -0.15);
    engine.ingest({ tagCode: tag, x: p.x + j, y: p.y - j, timestamp: new Date(clock).toISOString(), mapId: "m", ...(motion ? { motion } : {}) }); };
  const setMotion = (value: typeof motion) => { motion = value; };
  const walk = (from: P, to: P, speed = 1.2, hz = 4, tag = "T1") => {
    const steps = Math.max(1, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / speed * hz));
    for (let i = 1; i <= steps; i++) { advance(clock + 1000 / hz); packet({ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }, tag); }
  };
  const stay = (at: P, ms: number, hz = 4, tag = "T1") => { const end = clock + ms; while (clock + 1000 / hz <= end) { advance(clock + 1000 / hz); packet(at, tag); } advance(end); };
  const silence = (ms: number) => advance(clock + ms);
  const last = (tag = "T1") => out.filter(p => p.tagCode === tag).at(-1)!.regionInference;
  return { engine, out, packet, walk, stay, silence, last, advance, setMotion, now: () => clock };
}
const door = (config: typeof servis, roomId: string, out = 0.8, lateral = 0): P => {
  const d = config.regions.find(r => r.id === roomId)!.entrances[0], n = d.inwardNormal!;
  return { x: d.x - n.x * out - n.y * lateral, y: d.y - n.y * out + n.x * lateral };
};

test("saha #1: kapıda verisi kesilen tag doğru odaya (206) tahmini atanır ve uzun süre silinmez", () => {
  const h = harness();
  h.walk({ x: 1.8, y: 18 }, door(servis, "room-07", 0.9));
  h.walk(door(servis, "room-07", 0.9), door(servis, "room-07", 0.2), 0.8);
  h.silence(5000);
  assert.equal(h.last().regionId, "room-07");
  assert.equal(h.last().state, "INFERRED_IN_REGION");
  h.silence(10 * 60_000);
  assert.equal(h.last().regionId, "room-07", "10 dk sessizlikte oda tahmini korunmalı");
  assert.notEqual(h.last().state, "LOCATION_LOST");
});

test("saha #1 (yoğun bakım): Oda 7 kapısında kesilen tag Oda 7'ye atanır", () => {
  const h = harness(icu);
  h.walk({ x: 1.8, y: 10 }, door(icu, "room-07", 0.9));
  h.walk(door(icu, "room-07", 0.9), door(icu, "room-07", 0.2), 0.8);
  h.silence(6000);
  assert.equal(h.last().regionId, "room-07");
});

test("saha #2: sağdaki odaya girerken sola düşen 2 sıçrama tagı soldaki odaya atamaz", () => {
  const h = harness();
  h.walk({ x: 1.8, y: 20 }, door(servis, "room-03", 0.9));
  h.walk(door(servis, "room-03", 0.9), door(servis, "room-03", 0.1), 0.8);
  h.packet({ x: -0.8, y: 6.9 }); h.advance(h.now() + 200); h.packet({ x: -0.6, y: 6.8 }); // room-02 (201) içinde
  h.silence(30_000);
  assert.equal(h.last().regionId, "room-03");
});

test("saha #3: çıkış kapısından çıkan tag Dr Odası'na atanmaz, alan dışı olarak işaretlenir", () => {
  const h = harness();
  h.walk({ x: 1.8, y: 12 }, { x: 1.4, y: 1.5 });
  h.walk({ x: 1.4, y: 1.5 }, { x: 1.0, y: -0.3 }, 1.0);
  h.walk({ x: 1.0, y: -0.3 }, { x: 0.9, y: -2.5 }, 1.0);
  h.silence(60_000);
  const decision = h.last();
  assert.equal(decision.regionId, null);
  assert.equal(decision.outsideArea, true);
  assert.notEqual(decision.lastKnownRegionId, "room-01");
});

test("saha #4: 202 kapısının önünde (yanal 1 m) kesilen tag koridorda sabit kalmaz, 202'ye atanır", () => {
  const h = harness();
  h.walk({ x: 1.8, y: 16 }, door(servis, "room-03", 0.9, -1.0));
  h.silence(8000);
  assert.equal(h.last().regionId, "room-03");
});

test("koridor ortasında hareketsiz (10 sn blink) tag odaya atanmaz", () => {
  const h = harness();
  h.walk({ x: 1.8, y: 30 }, { x: 1.8, y: 19.5 });
  h.stay({ x: 1.8, y: 19.5 }, 32_000);
  for (let i = 0; i < 12; i++) { h.silence(10_000); if (i % 3 === 0) h.packet({ x: 1.8, y: 19.5 }); }
  assert.equal(h.last().regionId, null);
  assert.notEqual(h.last().state, "LOCATION_LOST");
});

test("kapıların önünden geçen tag hiçbir odaya atanmaz; 1,5 sn paket boşluğu oda girişi sayılmaz", () => {
  const h = harness();
  const rooms = new Set<string>();
  h.walk({ x: 1.0, y: 1.5 }, { x: 0.8, y: 20 });
  h.silence(1500);
  h.walk({ x: 0.8, y: 21.8 }, { x: 0.8, y: 40 });
  for (const p of h.out) if (p.regionInference.regionId) rooms.add(p.regionInference.regionId);
  assert.deepEqual([...rooms], []);
});

test("odadan çıkan tag koridor verisiyle hızlı (≤3 sn) koridora döner", () => {
  const h = harness();
  h.walk({ x: 1.8, y: 22 }, door(servis, "room-07", 0.9));
  h.walk(door(servis, "room-07", 0.9), door(servis, "room-07", 0.2), 0.8);
  h.silence(40_000);
  assert.equal(h.last().regionId, "room-07");
  const exitAt = h.now();
  h.walk(door(servis, "room-07", 0.1), { x: 1.8, y: 31 }, 1.2);
  const exited = h.out.find(p => Date.parse(p.publishedAt!) > exitAt && p.regionInference.regionId === null && p.regionInference.state === "TRACKING_OUTSIDE");
  assert.ok(exited, "koridora dönmeli");
  assert.ok(Date.parse(exited.publishedAt!) - exitAt <= 3000, `çıkış gecikmesi ${Date.parse(exited.publishedAt!) - exitAt} ms`);
});

test("içeriden sürekli veri gelen odada (duvar dibi) tag odada kalır", () => {
  const h = harness();
  h.walk({ x: 1.8, y: 8 }, { x: 0.6, y: 2.6 });
  h.stay({ x: -0.5, y: 2.6 }, 40_000);
  const assigned = h.out.filter(p => Date.parse(p.publishedAt!) > T0 + 15_000).filter(p => p.regionInference.regionId === "room-01").length;
  const total = h.out.filter(p => Date.parse(p.publishedAt!) > T0 + 15_000).length;
  assert.ok(assigned / total > 0.9, `${assigned}/${total}`);
});

test("tag hareketsiz bildirince kapının hemen önünde 3 dk beklese de odaya atanmaz", () => {
  const h = harness();
  h.setMotion("moving");
  h.walk({ x: 1.8, y: 18 }, door(servis, "room-07", 0.5));
  // Real firmware: the first stationary-flagged blink follows the last moving one by ~0.5 s.
  h.setMotion("stationary"); h.advance(h.now() + 500); h.packet(door(servis, "room-07", 0.5));
  const from = h.out.length;
  // Stationary firmware: one blink per 10 s, a third of them lost.
  for (let i = 0; i < 18; i++) { h.silence(10_000); if (i % 3 !== 2) h.packet(door(servis, "room-07", 0.5)); }
  assert.ok(h.out.slice(from).every(p => p.regionInference.regionId === null), "hareketsiz tag odaya geçmemeli");
});

test("odada hareketsiz tagın koridora düşen seyrek ölçümleri odadan çıkış sayılmaz; hareket bildirince hızla çıkar", () => {
  const h = harness();
  h.setMotion("moving");
  h.walk({ x: 1.8, y: 18 }, door(servis, "room-07", 0.9));
  h.walk(door(servis, "room-07", 0.9), door(servis, "room-07", -1.5), 0.8);
  h.silence(4000);
  assert.equal(h.last().regionId, "room-07");
  h.setMotion("stationary"); h.packet(door(servis, "room-07", -1.0));
  // 2 minutes of 10 s blinks; 6 of 10 land in the corridor right outside the door (leaky wall).
  for (let i = 0; i < 12; i++) { h.silence(10_000); h.packet(i % 5 < 3 ? door(servis, "room-07", 0.6) : door(servis, "room-07", -1.0)); }
  assert.equal(h.last().regionId, "room-07", "hareketsiz tag odada kalmalı");
  h.setMotion("moving");
  h.walk(door(servis, "room-07", -1.0), door(servis, "room-07", 1.2), 0.8);
  const leftAt = h.now();
  h.walk(door(servis, "room-07", 1.2), { x: 1.8, y: 30 });
  const back = h.out.find(p => Date.parse(p.publishedAt!) >= leftAt && p.regionInference.regionId === null);
  assert.ok(back && Date.parse(back.publishedAt!) - leftAt <= 4000, "hareket başlayınca koridora dönmeli");
});

test("Jetson'un koridora kırptığı oda içi çözüm (solverRaw) oda kanıtı sayılır", () => {
  let clock = T0; const out: ProcessedPosition[] = [];
  const engine = new RoomHmmEngine(p => out.push(p), 1000, () => clock, false);
  engine.enable(icu);
  const send = (shown: P, solver: P | null) => { clock += 250; engine.ingest({ tagCode: "T", x: shown.x, y: shown.y, timestamp: new Date(clock).toISOString(), mapId: "m",
    solverRaw: solver }); if ((clock - T0) % 1000 === 0) engine.tick(); };
  const a = { x: 1.8, y: 2 }, b = door(icu, "room-02", 0.9);
  for (let i = 1; i <= 40; i++) send({ x: a.x + (b.x - a.x) * i / 40, y: a.y + (b.y - a.y) * i / 40 }, null);
  // Inside the room: the Jetson clamps every solution onto the corridor edge in front of the door.
  for (let i = 0; i < 40; i++) send(door(icu, "room-02", 0.3, (i % 3 - 1) * 0.3), door(icu, "room-02", -2.0, (i % 3 - 1) * 0.3));
  assert.equal(out.at(-1)!.regionInference.regionId, "room-02");
});

test("bağlantı koparsa son karar korunur ve gösterilir; oda çıkışı ve alan çıkışı bildirilir", () => {
  const h = harness();
  // Kapılardan uzakta koridorda kopma: eskiden "belirsiz", şimdi koridor + sinyal yok.
  h.walk({ x: 1.8, y: 30 }, { x: 1.8, y: 29 });
  h.silence(5 * 60_000);
  assert.notEqual(h.last().state, "LOCATION_LOST");
  assert.equal(h.last().regionId, null);
  assert.equal(h.last().signalLost, true);
  // Odaya gir, odadan çık: çıkılan oda ve zaman yayımlanır.
  h.walk({ x: 1.8, y: 29 }, door(servis, "room-07", 0.9));
  h.walk(door(servis, "room-07", 0.9), door(servis, "room-07", -1.5), 0.8);
  h.silence(6000);
  assert.equal(h.last().regionId, "room-07");
  h.walk(door(servis, "room-07", -1.0), door(servis, "room-07", 1.2), 0.8);
  h.walk(door(servis, "room-07", 1.2), { x: 1.8, y: 14 });
  assert.equal(h.last().regionId, null);
  assert.equal(h.last().exitedRegionId, "room-07");
  assert.ok(h.last().exitedAt);
  // Çıkış kapısından alan dışı: zaman bilgisiyle.
  h.walk({ x: 1.8, y: 14 }, { x: 1.4, y: 1.5 });
  h.walk({ x: 1.4, y: 1.5 }, { x: 1.0, y: -0.3 }, 1.0);
  h.walk({ x: 1.0, y: -0.3 }, { x: 0.9, y: -2.5 }, 1.0);
  h.silence(60_000);
  assert.equal(h.last().outsideArea, true);
  assert.ok(h.last().leftAreaAt);
});

test("iki komşu kapının arasında susan tag koridorda bırakılmaz, en olası odaya alınır (16 Ekim rastgele test, 207)", () => {
  const h = harness();
  const mid = { x: 0.9, y: (door(servis, "room-08", 0.9).y + door(servis, "room-09", 0.9).y) / 2 - 0.3 };
  h.walk({ x: 1.8, y: 40 }, mid);
  h.silence(20_000);
  assert.ok(["room-08", "room-09"].includes(h.last().regionId ?? ""), `oda bekleniyordu, ${h.last().regionId}`);
});

test("3 anchorlu (ayna çözümlü) ölçüm odadaki tagı karşı odaya atamaz; 4+ anchorlu ölçüm kullanılır", () => {
  let clock = T0; const out: ProcessedPosition[] = [];
  const engine = new RoomHmmEngine(p => out.push(p), 1000, () => clock, false);
  engine.enable(servis);
  const send = (p: P, anchorCount: number) => { clock += 250; engine.ingest({ tagCode: "T", x: p.x, y: p.y, timestamp: new Date(clock).toISOString(), mapId: "m", anchorCount });
    if ((clock - T0) % 1000 === 0) engine.tick(); };
  const a = { x: 1.8, y: 14 }, b = door(servis, "room-02", 0.9);
  for (let i = 1; i <= 24; i++) send({ x: a.x + (b.x - a.x) * i / 24, y: a.y + (b.y - a.y) * i / 24 }, 6);
  for (let i = 0; i < 8; i++) send(door(servis, "room-02", -1.5), 5);  // 201 içinde, güvenilir
  for (let i = 0; i < 40; i++) send(door(servis, "room-12", -2.5), 3); // 216'ya düşen ayna noktaları
  assert.equal(out.at(-1)!.regionInference.regionId, "room-02");
});

test("kararlı mod: kapı eşiğinde 5 sn beklemek odayı göstermez, 10 sn kalınca gösterir", () => {
  let clock = T0; const out: ProcessedPosition[] = [];
  const engine = new RoomHmmEngine(p => out.push(p), 1000, () => clock, false);
  engine.enable(servis);
  const send = (p: P) => { clock += 250; engine.ingest({ tagCode: "T", x: p.x, y: p.y, timestamp: new Date(clock).toISOString(), mapId: "m" });
    if ((clock - T0) % 1000 === 0) engine.tick(); };
  const a = { x: 1.8, y: 20 }, b = door(servis, "room-07", 0.9);
  for (let i = 1; i <= 24; i++) send({ x: a.x + (b.x - a.x) * i / 24, y: a.y + (b.y - a.y) * i / 24 });
  const before = out.length;
  for (let i = 0; i < 20; i++) send(door(servis, "room-07", -0.6));   // eşikte 5 sn
  for (let i = 0; i < 12; i++) send(door(servis, "room-07", 1.2));    // koridora geri
  assert.ok(out.slice(before).every(p => p.regionInference.regionId === null), "kısa bekleme odayı göstermemeli");
  for (let i = 0; i < 40; i++) send(door(servis, "room-07", -1.0));   // odada 10 sn
  assert.equal(out.at(-1)!.regionInference.regionId, "room-07");
});

test("ayar doğrulaması ve harita başına motor seçimi", async () => {
  assert.throws(() => resolveRoomHmmSettings({ enterProbability: 0.4 }));
  assert.throws(() => resolveRoomHmmSettings({ bilinmeyen: 1 } as never));
  const dir = await mkdtemp(path.join(tmpdir(), "room-engine-"));
  await mkdir(path.join(dir, "a-map"));
  await writeFile(path.join(dir, "a-map", "room-engine.json"), JSON.stringify({ algorithm: "hmm", hmm: { doorProximitySigmaMeters: 0.9 } }));
  const selected = await readRoomEngineSelection("a-map", dir, {});
  assert.equal(selected.algorithm, "hmm"); assert.equal(selected.hmm.doorProximitySigmaMeters, 0.9);
  assert.equal((await readRoomEngineSelection("a-map", dir, { ROOM_ENGINE_ALGORITHM: "evidence" })).algorithm, "evidence");
  assert.equal((await readRoomEngineSelection("yok", dir, {})).algorithm, "evidence");
  assert.equal((await readRoomEngineSelection("necmettin-servis", undefined, {})).algorithm, "hmm");
  assert.equal((await readRoomEngineSelection("necmettin-yogun-bakim", undefined, {})).algorithm, "hmm");
});

test("hareket bayrağı yokken kapı önünde duran tag (10 sn'de bir ölçüm) odaya girip çıkmaz", () => {
  let clock = T0; const out: ProcessedPosition[] = [];
  const engine = new RoomHmmEngine(p => out.push(p), 1000, () => clock, false);
  engine.enable(icu);
  const send = (p: P) => engine.ingest({ tagCode: "T", x: p.x, y: p.y, timestamp: new Date(clock).toISOString(), mapId: "m" });
  const front = [door(icu, "room-05", 0.5), door(icu, "room-05", 0.4, 0.1), door(icu, "room-05", 2.2), door(icu, "room-05", 0.6, -0.1)];
  for (let i = 0; i < 4; i++) { clock += 10_000; send(front[0]); }   // durmaya başladı
  const before = out.length;
  for (let i = 0; i < 40; i++) {
    send(front[i % front.length]);
    for (let s = 0; s < 10; s++) { clock += 1000; engine.tick(); }
  }
  const rooms = out.slice(before).map(p => p.regionInference.regionId);
  assert.ok(rooms.every(r => r === null), `kapı önündeki duran tag odaya girmemeli: ${[...new Set(rooms)].join(",")}`);
});

test("yoğun bakım (camlı oda): odadaki tag duvar dibinde koridorda görünse de odadan çıkmış sayılmaz; gerçek çıkış yayımlanır", async () => {
  const selection = await readRoomEngineSelection("necmettin-yogun-bakim", undefined, {});
  let clock = T0; const out: ProcessedPosition[] = [];
  const engine = new RoomHmmEngine(p => out.push(p), 1000, () => clock, false, selection.hmm);
  engine.enable(icu);
  const send = (p: P) => { clock += 500; engine.ingest({ tagCode: "T", x: p.x, y: p.y, timestamp: new Date(clock).toISOString(), mapId: "m" }); if ((clock - T0) % 1000 === 0) engine.tick(); };
  const a = { x: 1.8, y: 9 }, b = door(icu, "room-03", 0.9);
  for (let i = 1; i <= 16; i++) send({ x: a.x + (b.x - a.x) * i / 16, y: a.y + (b.y - a.y) * i / 16 });
  for (let i = 0; i < 16; i++) send(door(icu, "room-03", -1.5, (i % 3 - 1) * 0.4));       // odada 8 sn
  assert.equal(out.at(-1)!.regionInference.regionId, "room-03");
  const before = out.length;
  for (let i = 0; i < 10; i++) send(door(icu, "room-03", 0.6, 1.0));                      // cam dibinde 5 sn koridor noktası
  for (let i = 0; i < 10; i++) send(door(icu, "room-03", -1.5));
  assert.ok(out.slice(before).every(p => p.regionInference.regionId === "room-03"), "duvar dibi koridor noktaları çıkış sayılmamalı");
  for (let i = 1; i <= 12; i++) send({ x: 0.6 + i * 0.15, y: 14.3 - i * 0.6 });            // koridorda uzaklaşıyor
  assert.equal(out.at(-1)!.regionInference.regionId, null);
});

test("yoğun bakım cam cephe: odadaki tagın cephenin önüne (koridora) düşen noktaları odada sayılır; koridorun ortası koridordur", async () => {
  const selection = await readRoomEngineSelection("necmettin-yogun-bakim", undefined, {});
  const run = (points: P[], settings: object) => {
    let clock = T0; const out: ProcessedPosition[] = [];
    const engine = new RoomHmmEngine(p => out.push(p), 1000, () => clock, false, settings);
    engine.enable(icu);
    const send = (p: P) => { clock += 500; engine.ingest({ tagCode: "T", x: p.x, y: p.y, timestamp: new Date(clock).toISOString(), mapId: "m" }); if ((clock - T0) % 1000 === 0) engine.tick(); };
    const a = { x: 2.5, y: 9 }, b = door(icu, "room-04", 0.9);
    for (let i = 1; i <= 12; i++) send({ x: a.x + (b.x - a.x) * i / 12, y: a.y + (b.y - a.y) * i / 12 });
    for (const p of points) send(p);
    return out.at(-1)!.regionInference.regionId;
  };
  // Oda 4'ün içinde, Jetson konumu cephenin 0,1–0,5 m önünde (koridor tarafında) 30 sn.
  const front = Array.from({ length: 60 }, (_, i) => door(icu, "room-04", 0.1 + (i % 5) * 0.1, (i % 3 - 1) * 0.6));
  assert.equal(run(front, selection.hmm), "room-04");
  assert.equal(run(front, resolveRoomHmmSettings({ ...selection.hmm, glassWallStripMeters: 0 })), null, "negatif kontrol: şerit kapalıyken koridor");
  // Koridorun ortasında (duvardan 2,5 m) duran tag odaya alınmaz.
  const mid = Array.from({ length: 60 }, (_, i) => door(icu, "room-04", 2.5, (i % 3 - 1) * 0.3));
  assert.equal(run(mid, selection.hmm), null);
});

test("yoğun bakım: hareketsiz tagın koridordaki işareti Jetson sıçramalarıyla oynamaz, gerçekten yer değiştirince taşınır", async () => {
  const selection = await readRoomEngineSelection("necmettin-yogun-bakim", undefined, {});
  const run = (settings: object) => {
    let clock = T0; const shown: P[] = [];
    const engine = new RoomHmmEngine(p => { if (p.tagCode === "S") shown.push({ x: p.rawPosition!.x, y: p.rawPosition!.y }); }, 1000, () => clock, false, settings);
    engine.enable(icu);
    const jitter = [{ x: 2.2, y: 7.6 }, { x: 0.5, y: 7.9 }, { x: 2.3, y: 7.7 }, { x: 3.4, y: 8.6 }, { x: 2.1, y: 7.5 }];
    for (let i = 0; i < 40; i++) { clock += 10_000; engine.ingest({ tagCode: "S", x: jitter[i % 5].x, y: jitter[i % 5].y, timestamp: new Date(clock).toISOString(), mapId: "m" }); }
    const settled = shown.slice(10);
    let path = 0; for (let i = 1; i < settled.length; i++) path += Math.hypot(settled[i].x - settled[i - 1].x, settled[i].y - settled[i - 1].y);
    // Gerçek yer değişimi: 6 m ötede art arda ölçümler.
    for (let i = 0; i < 4; i++) { clock += 10_000; engine.ingest({ tagCode: "S", x: 2.2, y: 13.6, timestamp: new Date(clock).toISOString(), mapId: "m" }); }
    return { path, last: shown.at(-1)! };
  };
  // Dondurma kapalıyken (hareket bilgisi gelmeyen kurulum) ortanca sabitleme davranışı.
  const held = run(resolveRoomHmmSettings({ ...selection.hmm, stationaryFreeze: 0 })), free = run(resolveRoomHmmSettings({ ...selection.hmm, stationaryFreeze: 0, stationaryDisplayHoldMeters: 0 }));
  assert.ok(held.path < 0.6, `sabit tag oynamamalı: ${held.path.toFixed(2)} m`);
  assert.ok(free.path > 10, `negatif kontrol: ${free.path.toFixed(2)} m`);
  assert.ok(Math.hypot(held.last.x - 2.2, held.last.y - 13.6) < 0.5, "yer değişimi gösterilmeli");
});

test("hareketsiz tag (IMU): oda kararı donar, karşı odaya sıçrayan noktalar ve veri boşlukları kararı değiştirmez; hareket edince normale döner", async () => {
  const selection = await readRoomEngineSelection("necmettin-yogun-bakim", undefined, {});
  let clock = T0; const out: ProcessedPosition[] = [];
  const engine = new RoomHmmEngine(p => out.push(p), 1000, () => clock, false, selection.hmm);
  engine.enable(icu);
  const send = (p: P, motion: "moving" | "stationary") => engine.ingest({ tagCode: "S", x: p.x, y: p.y, timestamp: new Date(clock).toISOString(), mapId: "m", motion });
  const spot = { x: 2.4, y: 11.0 };
  for (let i = 0; i < 160; i++) { clock += 500; send({ x: spot.x + (i % 2 ? 0.1 : -0.1), y: spot.y }, "moving"); if (i % 2) engine.tick(); }  // 80 sn koridorda
  assert.equal(out.at(-1)!.regionInference.regionId, null);
  const shownBefore = out.at(-1)!.rawPosition!;
  // Hareketsiz: 10 sn'de bir; her üç ölçümden biri Oda 4'ün içine (3 anchorlu ayna), arada 40 sn veri yok.
  const before = out.length;
  for (let i = 0; i < 30; i++) {
    for (let k = 0; k < 10; k++) { clock += 1000; engine.tick(); }
    if (i === 12) { for (let k = 0; k < 40; k++) { clock += 1000; engine.tick(); } }
    send(i % 3 === 0 ? { x: -1.0, y: 11.1 } : { x: spot.x + 0.3, y: spot.y - 0.2 }, "stationary");
  }
  assert.ok(out.slice(before).every(p => p.regionInference.regionId === null), "hareketsizken oda kararı değişmemeli");
  const shown = out.slice(before).map(p => p.rawPosition!);
  assert.ok(shown.every(p => Math.hypot(p.x - shownBefore.x, p.y - shownBefore.y) < 0.6), "işaret son hareketli konumda kalmalı");
  // Hareket: Oda 4'e girer.
  for (let i = 1; i <= 8; i++) { clock += 500; send({ x: 2.4 - i * 0.3, y: 11.1 }, "moving"); }
  for (let i = 0; i < 30; i++) { clock += 500; send({ x: -1.5, y: 11.1 }, "moving"); if (i % 2) engine.tick(); }
  assert.equal(out.at(-1)!.regionInference.regionId, "room-04");
});

test("yoğun bakım saha 21 Ekim: hareketsiz HBM'nin tek Jetson sıçraması ve tekrarlanan alan dışı koordinatı Oda 3'e kilitlemez", async () => {
  const selection = await readRoomEngineSelection("necmettin-yogun-bakim", undefined, {});
  const run = (hmm: Record<string, number>) => {
    let clock = T0; const out: ProcessedPosition[] = [];
    const engine = new RoomHmmEngine(p => out.push(p), 1000, () => clock, false, hmm);
    engine.enable(icu);
    const send = (x: number, y: number) => engine.ingest({ tagCode: "H", x, y, timestamp: new Date(clock).toISOString(), mapId: "m" });
    const wait = () => { for (let k = 0; k < 10; k++) { clock += 1000; engine.tick(); } };
    const spot = (i: number) => send(4.9 + (i % 3) * 0.05, 14.7 - (i % 2) * 0.1);
    for (let i = 0; i < 90; i++) { spot(i); wait(); }          // 15 dk, 10 sn'de bir, koridorda
    send(0.18, 15.07); wait();                                  // Jetson sıçraması (Oda 3 cephesi)
    for (let i = 0; i < 3; i++) { send(-2.04, 15.07); wait(); } // Jetson'un tekrarladığı alan dışı nokta
    const during = out.length;
    for (let i = 0; i < 60; i++) { spot(i); wait(); }          // 10 dk yine aynı yerde
    return { out, during };
  };
  const fixed = run(selection.hmm as unknown as Record<string, number>);
  assert.equal(fixed.out.at(-1)!.regionInference.regionId, null, "sonunda koridorda olmalı");
  assert.ok(fixed.out.slice(fixed.during + 12).every(p => p.regionInference.regionId === null), "2 dk içinde Oda 3 bırakılmalı");
  // Negatif kontrol: yeni ayarlar olmadan karar Oda 3'te kilitli kalıyordu.
  const { stationaryFreezeInferredMinAgeMs, stationaryFreezeReleaseSamples, stableEntryMinSamples, ignoreRepeatedCoordinates, silenceCadenceFactor, ...old } = selection.hmm as unknown as Record<string, number>;
  void stationaryFreezeInferredMinAgeMs; void stationaryFreezeReleaseSamples; void stableEntryMinSamples; void ignoreRepeatedCoordinates; void silenceCadenceFactor;
  assert.equal(run(old).out.at(-1)!.regionInference.regionId, "room-03");
});

test("yoğun bakım saha 22 Ekim: hareketsiz tekerlekli sandalye sol kapıdan çıkınca koridorun ucunda donmuş kalmaz, alan dışı olur", async () => {
  const selection = await readRoomEngineSelection("necmettin-yogun-bakim", undefined, {});
  const run = (hmm: Record<string, number>) => {
    let clock = T0; const out: ProcessedPosition[] = [];
    const engine = new RoomHmmEngine(p => out.push(p), 1000, () => clock, false, hmm);
    engine.enable(icu);
    const send = (x: number, y: number, motion: "moving" | "stationary") => engine.ingest({ tagCode: "W", x, y, timestamp: new Date(clock).toISOString(), mapId: "m", motion });
    for (let i = 0; i < 120; i++) { clock += 1000; send(1.8 + (i % 2) * 0.05, 4.6, "stationary"); if (i % 5 === 0) engine.tick(); }
    // Sol uca yürür; Jetson konumu bölge kenarına (y = 0) sıkıştırır.
    for (let i = 0; i < 40; i++) { clock += 500; send(1 + (i % 3) * 0.4, Math.max(0, 4.6 - i * 0.25), "moving"); }
    for (let i = 0; i < 6; i++) { clock += 10_000; send(1.2 + (i % 2) * 0.7, 0, "stationary"); }
    // Jetson artık alanın dışını bildiriyor (y ≈ −6).
    for (let i = 0; i < 6; i++) { clock += 10_000; send(1.9 - (i % 2) * 0.9, -5.6 - (i % 3), "stationary"); }
    return out.at(-1)!.regionInference;
  };
  const fixed = run(selection.hmm as unknown as Record<string, number>);
  assert.equal(fixed.outsideArea, true, "alan dışı olmalı");
  assert.equal(fixed.leftAreaGate, "Sol koridor giriş / çıkış kapısı");
  const old = run({ ...(selection.hmm as unknown as Record<string, number>), stationaryFreezeReleaseSamples: 0 });
  assert.notEqual(old.outsideArea, true, "negatif kontrol: eski davranışta koridorda donup kalıyordu");
});
