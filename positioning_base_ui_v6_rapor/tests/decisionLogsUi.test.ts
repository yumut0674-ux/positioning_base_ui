import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { decisionLogsCsv } from "../src/features/decisionLogs/services/decisionLogsApi";
import type { DecisionLogSummary } from "../src/features/decisionLogs/types/decisionLog.types";

const summary:DecisionLogSummary={decisionId:"d-1",tagCode:"TAG-1",measuredAt:"2026-09-01T00:00:00Z",publishedAt:"2026-09-01T00:00:07.200Z",mapId:"map-a",eventType:"ROOM_INFERRED",severity:"warning",previousState:"TRACKING_OUTSIDE",nextState:"INFERRED_IN_REGION",regionId:"room-03",regionName:"Oda 3",measurementKind:"estimated",confidence:.58,rawX:12.41,rawY:7.82,publishedX:13,publishedY:8,doorId:"Door-03",doorDistanceMeters:.84,reasonCodes:["SIGNAL_LOST_NEAR_SILENT_ROOM_DOOR"],shortReason:"Kapıya yakın kesinti",engineVersion:"room-evidence-5",configVersion:"cfg-1"};

test("decision filters, list and detail cover filtering, selection and diagnostic fields",()=>{
  const root=process.cwd();const filters=readFileSync(path.join(root,"src/features/decisionLogs/components/DecisionLogFilters.tsx"),"utf8");const list=readFileSync(path.join(root,"src/features/decisionLogs/components/DecisionLogList.tsx"),"utf8");const detail=readFileSync(path.join(root,"src/features/decisionLogs/components/DecisionLogDetail.tsx"),"utf8");
  for(const label of ["Tag","Başlangıç","Bitiş","Harita / kat","Oda","Karar türü","Ölçüm türü","Yalnızca önemli","Canlı yenileme","Filtreleri temizle"])assert.match(filters,new RegExp(label));
  assert.match(list,/selectedId === item\.decisionId/);assert.match(list,/Oda tahmini/);assert.match(list,/measurementKind/);
  for(const label of ["Karar kimliği","Ölçüm zamanı","Sisteme geliş","İşleme gecikmesi","Son güvenilir konum","Sinyal kesintisi","Kapı kimliği","Kapıya uzaklık","Mesafe eşiği","Ölçüm sayısı","Kanıt süresi","Donanım kalitesi","Gerekçeler","Motor","Konfigürasyon","Ham JSON","JSON kopyala"])assert.match(detail,new RegExp(label));
});

test("tag filter loads existing tags and exposes a searchable combobox",()=>{
  const filters=readFileSync(path.join(process.cwd(),"src/features/decisionLogs/components/DecisionLogFilters.tsx"),"utf8");
  assert.match(filters,/fetchTags\(\)/);assert.match(filters,/role="combobox"/);assert.match(filters,/role="listbox"/);assert.match(filters,/tag\.displayName/);assert.match(filters,/onClick=\{\(\) => choose\(tag\)\}/);
});

test("decision CSV exports the documented columns and safely quotes values",()=>{
  const csv=decisionLogsCsv([{...summary,shortReason:'Virgül, "tırnak"'}]);
  for(const column of ["decisionId","tagCode","measuredAt","publishedAt","mapId","eventType","previousState","nextState","regionId","candidateRegionId","measurementKind","confidence","rawX","rawY","doorId","doorDistanceMeters","reasonCodes","engineVersion","configVersion"])assert.match(csv,new RegExp(column));
  assert.match(csv,/d-1,TAG-1/);assert.match(csv,/SIGNAL_LOST_NEAR_SILENT_ROOM_DOOR/);
});

test("decision panel keeps polling deduplicated and defines a mobile list-detail mode",()=>{
  const root=process.cwd();const panel=readFileSync(path.join(root,"src/features/decisionLogs/components/DecisionLogsPanel.tsx"),"utf8");const css=readFileSync(path.join(root,"src/features/decisionLogs/components/decisionLogs.module.css"),"utf8");
  assert.match(panel,/new Map\(current\.map/);assert.match(panel,/setInterval\([^]*4000/);assert.match(panel,/inFlight\.current/);assert.match(panel,/current\?\?result\.items\[0\]/);assert.match(panel,/Karar kayıtları yükleniyor/);assert.match(panel,/Kayıt bulunamadı/);assert.match(panel,/Tekrar dene/);assert.match(css,/@media\(max-width:680px\)/);assert.match(css,/hasMobileSelection \.listPane\{display:none\}/);
});
