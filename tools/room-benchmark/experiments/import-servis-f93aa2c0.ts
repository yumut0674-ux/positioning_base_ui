import {readFile,writeFile} from 'node:fs/promises';
import {queryPostgres} from '../../../src/server/postgresClient';
import {datasetDir,listCandidates,importTest} from '../importer';

const id='test-f93aa2c0-e0fc-4130-b0c5-3d1207fd120a';
const auditDir='tools/room-benchmark/reports/servis-f93aa2c0-audit-20261013';
const source=JSON.parse(await readFile(datasetDir(id)+'/source.json','utf8'));
const audit=JSON.parse(await readFile(auditDir+'/session-audit.json','utf8'));
const quote=(s:string)=>`'${s.replaceAll("'","''")}'`;
const intervals=source.rooms as {room:string;entered_at:string;exited_at:string;duration_seconds:number}[];
let previous=Date.parse(source.started_at);
for(const interval of intervals){
  const from=Date.parse(interval.entered_at),to=Date.parse(interval.exited_at);
  if(from<previous||to<=from||Math.abs((to-from)/1000-interval.duration_seconds)>0.000001)throw new Error('Kaynak aralık/süre hatası');
  previous=to;
}
const recordedRooms=audit.projection?.visits.filter((v:{areaType:string})=>v.areaType==='room')??[];
if(recordedRooms.length!==intervals.length||recordedRooms.some((v:{areaId:string;enteredAt:string;exitedAt:string},i:number)=>
  v.areaId!==intervals[i].room||v.enteredAt!==intervals[i].entered_at||v.exitedAt!==intervals[i].exited_at))throw new Error('DB oda aralıkları kullanıcı kaydıyla uyuşmuyor');
const cutoff=intervals.at(-1)!.exited_at;
const truth={testId:id,testName:'Servis — Oda testi — 9C76E417B4CB5ECF',site:'Necmettin Hastanesi — Servis',timezone:'Europe/Istanbul',revision:1,
  revisionReason:'Kullanıcının UTC milisaniyeli 13 ziyareti ve açık tag kodu, SELECT ile kayıtlı test oturumunda doğrulandı. ended_at null/running: puanlama son tamamlanmış oda çıkışıyla sınırlıdır; gerçek bitiş saati uydurulmadı.',
  sourceEndedAt:null,evaluationEndBasis:'last-completed-user-visit',evaluationIsPartial:true,recordedSessionStatus:audit.projection.status,
  test:{from:source.started_at,to:cutoff},visits:intervals.map(v=>({roomId:v.room,from:v.entered_at,to:v.exited_at})),
  corridorIntervals:audit.projection.visits.filter((v:{areaType:string;exitedAt:string|null})=>v.areaType==='corridor'&&v.exitedAt!==null).map((v:{areaId:string;enteredAt:string;exitedAt:string})=>({regionId:v.areaId,from:v.enteredAt,to:v.exitedAt})),
  groups:[{id:'servis-f93aa2c0',tagCodes:source.tag_codes,note:'Tag kullanıcı JSON kaydında açıktır; DB test oturumunda aynı kod tagVerified=true. Güncel tags tablosunda ad kaydı bulunmadı; başka tag atanmadı.'}],
  recordedPlanHash:audit.session.configHash,
  note:'Kısmi test: kaynak ended_at null; son tamamlanmış ziyaret çıkışı 2026-10-13T07:14:54.157Z yalnız değerlendirme sınırıdır. Sonraki 60 sn gözlem puanlanmaz. Z UTC; Europe/Istanbul gösterim +03:00. Saatler korunur; katı ve ±2 sn sınır toleransı. DB koridor seçimleri oda aralıkları arasındaki konumu doğrular.'};
try{await writeFile(datasetDir(id)+'/truth.json',JSON.stringify(truth,null,2)+'\n',{flag:'wx'});}
catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
  if(JSON.stringify(JSON.parse(await readFile(datasetDir(id)+'/truth.json','utf8')))!==JSON.stringify(truth))throw new Error('Mevcut truth farklı; üzerine yazılmadı');}
const candidates=await listCandidates(id);
console.log(JSON.stringify({testId:id,evaluationCutoff:cutoff,partial:true,candidates},null,2));
const from=new Date(Date.parse(source.started_at)-30000).toISOString(),to=new Date(Date.parse(cutoff)+60000).toISOString();
const filter=`tag_code=${quote(source.tag_id)} AND published_at BETWEEN ${quote(from)}::timestamptz AND ${quote(to)}::timestamptz`;
const versions=await queryPostgres(`SELECT engine_version,config_version,map_id,count(*)::text AS count FROM tag_room_decisions WHERE ${filter} GROUP BY engine_version,config_version,map_id`);
const decisions=await queryPostgres(`SELECT id::text,measured_at::text,published_at::text,engine_version,config_version,map_id,state,region_id,event_type,reason_codes::text,payload::text FROM tag_room_decisions WHERE ${filter} ORDER BY published_at,id`);
await writeFile(auditDir+'/recorded-decisions.json',JSON.stringify({testId:id,candidates,versions,decisions},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({versions,recordedDecisionCount:decisions.length}));
if(!(source.tag_id in candidates)){
  const tagHistory=await queryPostgres(`SELECT tag_code,count(*)::text AS count,min(created_at)::text AS first_at,max(created_at)::text AS last_at FROM tag_location_history WHERE upper(tag_code)=${quote(source.tag_id)} GROUP BY tag_code`);
  await writeFile(auditDir+'/missing-raw-diagnostic.json',JSON.stringify({tagHistory,candidates},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({missingRawForSelectedTag:true,tagHistory}));
}else{
  const manifest=await importTest(id,[source.tag_id]);
  console.log(JSON.stringify(manifest,null,2));
}
