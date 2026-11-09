import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import test from "node:test";
import type { ProcessedPosition } from "../src/server/regionEngine/types";
import type { PgRow } from "../src/server/postgresClient";
import { buildAdminRouteRows, type StoredRouteDecision } from "../src/server/reports/adminRouteReport";
import { loadAdminRouteReport } from "../src/server/reports/adminRouteReportService";
import { createAdminRouteReportHandler } from "../src/server/reports/adminRouteReportHttp";
import { DecisionReportError } from "../src/server/reports/decisionReportRequest";
import { adminRouteCsv, adminRouteDuration, buildAdminRouteDefinition, createAdminRoutePdf, createAdminRouteXlsx } from "../src/server/reports/adminRouteReportFormats";

const start = Date.parse("2026-10-30T08:00:00Z");
const at = (seconds: number) => new Date(start + seconds * 1000).toISOString();
const request = (seconds = 60) => ({ from: at(0), to: at(seconds), format: "xlsx" as const });
const rooms = [{ mapId: "servis", mapName: "Servis", roomId: "203", roomName: "203" }, { mapId: "servis", mapName: "Servis", roomId: "204", roomName: "204" }];
function decision(seconds: number, roomId: string | null = null, inference: Partial<ProcessedPosition["regionInference"]> = {}, extra: Partial<ProcessedPosition> = {}): StoredRouteDecision {
  return { tagName: "HBM Mindray Servis", position: { tagCode: "HBM", x: 1, y: 2, timestamp: at(seconds), lastRawDataTimestamp: at(seconds),
    publishedAt: at(seconds), decisionId: `d-${seconds}`, mapId: "servis", positionSource: "RAW",
    regionInference: { enabled: true, state: roomId ? "IN_REGION" : "TRACKING_OUTSIDE", regionId: roomId, measurementKind: "measured",
      validUntil: at(seconds + 3660), uncertainAfter: at(seconds + 7200), ...inference }, ...extra } };
}
const rowsFrom = (list: readonly StoredRouteDecision[]): PgRow[] => list.map((d,i) => ({ id: String(i+1), event_id: d.position.decisionId!,
  tag_code: d.position.tagCode, tag_name: d.tagName, published_at: d.position.publishedAt!, payload: JSON.stringify(d.position) }));
function report(list: readonly StoredRouteDecision[], seconds = 60) {
  return { ...request(seconds), generatedAt: at(4000), timezone: "Europe/Istanbul" as const, filters: {}, rows: buildAdminRouteRows(request(seconds), list, rooms) };
}

test("one hour of uninterrupted corridor measurements becomes exactly one hour-long stay", () => {
  const list = Array.from({ length: 361 }, (_,i) => decision(i*10, null, { validUntil: at(i*10+12), uncertainAfter: at(i*10+60) }));
  const before = structuredClone(list), rows = buildAdminRouteRows(request(3600), list, rooms);
  assert.equal(rows.length, 1); assert.equal(rows[0].location, "Koridor"); assert.equal(rows[0].durationMs, 3_600_000);
  assert.equal(adminRouteDuration(rows[0].durationMs), "1 sa"); assert.deepEqual(list, before);
});

test("room-corridor-same room keeps even a half-second corridor and two separate visits", () => {
  const rows = report([decision(0, "203"), decision(10, "203", { state: "EXIT_CANDIDATE" }), decision(20), decision(20.5, "203")]).rows;
  assert.deepEqual(rows.map(r => r.location), ["203", "Koridor", "203"]);
  assert.deepEqual(rows.map(r => r.durationMs), [20_000, 500, 39_500]);
  assert.equal(rows.reduce((sum,r)=>sum+r.durationMs,0), 60_000);
});

test("another room, map, candidate or lost location always breaks a room visit", () => {
  const list = [decision(0,"203"), decision(10,"204"), decision(20,"203"),
    decision(30,null,{state:"ENTRY_CANDIDATE",measurementKind:"uncertain",candidateRegionId:"203"}), decision(40,"203"),
    decision(45,"203",{}, {mapId:"other"}), decision(50,"203"), decision(55,null,{state:"LOCATION_LOST",measurementKind:"uncertain"})];
  const rows = report(list).rows;
  assert.equal(rows.length, 8); assert.equal(rows[3].location,"Oda adayı: 203"); assert.equal(rows[3].roomId,"");
  assert.equal(rows.at(-1)!.kind,"uncertain");
});

test("measured, inferred and exit candidate states in the same room remain one stay", () => {
  const rows = report([decision(0,"203"), decision(10,"203",{state:"INFERRED_IN_REGION",measurementKind:"estimated"}),
    decision(20,"203",{state:"EXIT_CANDIDATE"}), decision(30,"203")]).rows;
  assert.equal(rows.length,1); assert.equal(rows[0].durationMs,60_000);
  assert.deepEqual(rows[0].measurementKinds,["measured","estimated"]);
});

test("stored freshness limits introduce uncertainty instead of inflating room or corridor time", () => {
  const room = report([decision(0,"203",{validUntil:at(12),uncertainAfter:at(30)})]).rows;
  assert.deepEqual(room.map(r=>[r.kind,r.durationMs]),[["room",30_000],["uncertain",30_000]]);
  assert.deepEqual(room[0].measurementKinds,["measured","estimated"]);
  const corridor = report([decision(0,null,{validUntil:at(12),uncertainAfter:at(30)})]).rows;
  assert.deepEqual(corridor.map(r=>[r.kind,r.durationMs]),[["corridor",12_000],["uncertain",48_000]]);
});

test("range boundaries clip stays, old expired seeds are ignored, and missing evidence stays visible", () => {
  const rows = report([decision(-5,"203",{validUntil:at(12),uncertainAfter:at(70)}),decision(20,"203")]).rows;
  assert.equal(rows.length,1); assert.equal(rows[0].from,at(0)); assert.equal(rows[0].to,at(60));
  assert.equal(report([decision(-100,null,{validUntil:at(-90),uncertainAfter:at(-40)})]).rows.length,0);
  const noExpiry = report([decision(10,"203",{validUntil:undefined,uncertainAfter:undefined})]).rows;
  assert.deepEqual(noExpiry.map(r=>[r.kind,r.durationMs]),[["gap",10_000],["room",0],["gap",50_000]]);
});

test("room selection preserves original visit boundaries after removing the intervening corridor", () => {
  const list = [decision(0,"203"),decision(10),decision(11,"203"),decision(20,"204"),decision(30,"203")];
  const rows = buildAdminRouteRows({...request(),regionId:"203"},list,rooms);
  assert.deepEqual(rows.map(r=>[r.from,r.to]),[[at(0),at(10)],[at(11),at(20)],[at(30),at(60)]]);
});

test("simultaneous different location decisions remain visible without being turned into positive stays", () => {
  const rows = report([decision(0,"203"),decision(0,"204"),decision(1,"203")]).rows;
  assert.deepEqual(rows.map(r=>[r.location,r.durationMs]),[["203",0],["204",1000],["203",59_000]]);
});

test("database reads include boundary seeds and every intervening location, without duration or kind filters", async () => {
  const list=[decision(10,"203"),decision(20),decision(21,"203")], queries:string[]=[];
  const data=await loadAdminRouteReport({...request(),tagCode:"hbm",mapId:"servis",regionId:"203"},new Date(at(100)),{
    query:async sql=>{queries.push(sql);return rowsFrom(sql.includes("DISTINCT ON")?[decision(-5,"203")]:list);}, rooms:async()=>rooms,
  });
  assert.equal(queries.length,2); assert.equal(data.rows.length,2); assert.equal(data.rows[0].from,at(0));
  for(const sql of queries){assert.match(sql,/^SELECT /);assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|CREATE|ALTER)\b/);assert.match(sql,/strpos\(upper\(d.tag_code\),'HBM'\)/);assert.doesNotMatch(sql,/measurement_kind|candidate_region_id|d\.map_id\s*=|d\.region_id\s*=/);}
  assert.match(queries[0],/ORDER BY d\.published_at,d\.id LIMIT 50001/);
});

test("malformed, empty and oversized database selections fail explicitly", async()=>{
  await assert.rejects(()=>loadAdminRouteReport(request(),new Date(at(100)),{query:async()=>[],rooms:async()=>rooms}),DecisionReportError);
  const row=rowsFrom([decision(0)])[0];
  await assert.rejects(()=>loadAdminRouteReport(request(),new Date(at(100)),{query:async()=>[{...row,payload:"{}"}],rooms:async()=>rooms}),/Konum kaydı okunamadı/);
  await assert.rejects(()=>loadAdminRouteReport(request(),new Date(at(100)),{query:async()=>Array(50001).fill(row),rooms:async()=>rooms}),/50.000/);
});

function unzip(bytes:Uint8Array):Map<string,string>{
  const buffer=Buffer.from(bytes),files=new Map<string,string>();let offset=0;
  while(buffer.readUInt32LE(offset)===0x04034b50){const size=buffer.readUInt32LE(offset+18),length=buffer.readUInt16LE(offset+26),extra=buffer.readUInt16LE(offset+28),start=offset+30+length+extra;
    files.set(buffer.subarray(offset+30,offset+30+length).toString(),inflateRawSync(buffer.subarray(start,start+size)).toString());offset=start+size;}
  return files;
}
test("Excel and CSV expose compact stays with both native dates and exact duration, without diagnostic columns",()=>{
  const data=report([decision(0,"203"),decision(10),decision(10.5,"203")]);
  const csv=adminRouteCsv(data); assert.match(csv,/Başlangıç \(TR\)/); assert.match(csv,/Süre \(saniye\)/);assert.doesNotMatch(csv,/Ham X|Gerekçe|Önceki durum|Durum geçişi/);
  const files=unzip(createAdminRouteXlsx(data)),sheet=files.get("xl/worksheets/sheet1.xml")!;
  assert.equal((sheet.match(/<row /g)??[]).length,4); assert.match(sheet,/<c r="D2" s="2"><v>/);assert.match(sheet,/<c r="E2" s="2"><v>/);
  assert.match(files.get("xl/workbook.xml")!,/name="Oda_Koridor"/);
  const injected={...data,rows:[{...data.rows[0],tagName:'=HYPERLINK("x")'}]};
  assert.match(adminRouteCsv(injected),/'=HYPERLINK/);assert.doesNotMatch(unzip(createAdminRouteXlsx(injected)).get("xl/worksheets/sheet1.xml")!,/<f[ >]/);
});

test("all admin formats use the same stays and endpoint does not expose original payloads",async()=>{
  const data=report([decision(0,"203"),decision(10),decision(11,"203")]);
  const handler=createAdminRouteReportHandler(async()=>data,()=>new Date(at(100)));
  for(const format of ["xlsx","csv","json"]){const response=await handler(new Request("http://local/api/reports/admin-route-history",{method:"POST",body:JSON.stringify({...request(),format})}));
    assert.equal(response.status,200);assert.equal(response.headers.get("X-Interval-Count"),"3");assert.match(response.headers.get("Content-Disposition")!,/yonetici-oda-koridor/);
    if(format==="json"){const json=await response.json();assert.equal(json.rows.length,3);assert.equal(json.items,undefined);assert.doesNotMatch(JSON.stringify(json),/decisionTrace|rawPosition|payload/);}}
  const failed=createAdminRouteReportHandler(async()=>{throw new DecisionReportError("limit",422);},()=>new Date(at(100)));
  assert.equal((await failed(new Request("http://local",{method:"POST",body:JSON.stringify(request())}))).status,422);
});

test("PDF has a compact room/corridor table and rejects partial over-limit output",async()=>{
  const data=report([decision(0,"203"),decision(10),decision(11,"203")]);
  const definition=buildAdminRouteDefinition(data);
  const content=definition.content as {table?:{body:{text:string}[][]}}[];
  const body=content.find(item=>item.table)!.table!.body;
  assert.equal(body.length,4);assert.equal(body[0].length,6);assert.equal(body[2][3].text,"Koridor");
  const bytes=await createAdminRoutePdf(data);assert.equal(Buffer.from(bytes.subarray(0,5)).toString(),"%PDF-");
  assert.throws(()=>buildAdminRouteDefinition({...data,rows:Array(5001).fill(data.rows[0])}),/5.000 konum aralığı/);
});
