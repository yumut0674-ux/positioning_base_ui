import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {queryPostgres} from '../../../src/server/postgresClient';
import {projectSession,type TestSession} from '../../../src/features/roomTests/services/roomTestModel';
import {datasetDir,listCandidates} from '../importer';
import {sha256} from '../model';
const ids=['test-344ab34d-5988-4308-be11-99eb88a54bd4','test-9a7debf0-57ad-4df2-802b-ae92e4c20b13'];
const dir='tools/room-benchmark/reports/servis-pdop-two-20261013';
const q=(s:string)=>`'${s.replaceAll("'","''")}'`;
await mkdir(dir,{recursive:true});
const protectedPaths=execFileSync('git',['ls-files'],{encoding:'utf8'}).trim().split('\n').filter(p=>!p.startsWith('tools/room-benchmark/'));
protectedPaths.push('src/shared/tracking/pdop.ts');
const hashes:Record<string,string>={};
for(const p of new Set(protectedPaths))hashes[p]=await sha256(await readFile(p));
try{await writeFile(dir+'/source-hashes-before.json',JSON.stringify(hashes,null,2)+'\n',{flag:'wx'});}
catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
const columns=await queryPostgres("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='tag_location_history' ORDER BY ordinal_position");
const hasPdop=columns.some(c=>c.column_name==='pdop');
console.log(JSON.stringify({hasPdop}));
for(const id of ids){
  const source=JSON.parse(await readFile(datasetDir(id)+'/source.json','utf8'));
  const rooms=source.rooms as {room:string;entered_at:string;exited_at:string;duration_seconds:number}[];
  let last=Date.parse(source.started_at);
  for(const v of rooms){if(Date.parse(v.entered_at)<last||Date.parse(v.exited_at)<=Date.parse(v.entered_at)||Date.parse(v.exited_at)>Date.parse(source.ended_at)||Math.abs((Date.parse(v.exited_at)-Date.parse(v.entered_at))/1000-v.duration_seconds)>0.000001)throw Error('Kaynak aralık/süre hatası');last=Date.parse(v.exited_at);}
  const sessions=await queryPostgres(`SELECT payload::text FROM room_test_sessions WHERE id=${q(id)}`);
  const session=sessions[0]?.payload?JSON.parse(sessions[0].payload) as TestSession:null,projection=session?projectSession(session):null;
  if(projection){const visits=projection.visits.filter(v=>v.areaType==='room');
    if(projection.startedAt!==source.started_at||projection.endedAt!==source.ended_at||visits.length!==rooms.length||visits.some((v,i)=>v.areaId!==rooms[i].room||v.enteredAt!==rooms[i].entered_at||v.exitedAt!==rooms[i].exited_at))throw Error('DB oturumu verilen testle uyuşmuyor');}
  const truth={testId:id,testName:'Servis — Oda testi — '+id.split('-')[1],site:'Necmettin Hastanesi — Servis',timezone:'Europe/Istanbul',revision:1,
    revisionReason:'Kullanıcının UTC milisaniyeli oda ziyaretleri ve açık tag kodu korunarak eklendi; test oturumu salt okunur kontrol edildi.',
    test:{from:source.started_at,to:source.ended_at},visits:rooms.map(v=>({roomId:v.room,from:v.entered_at,to:v.exited_at})),
    groups:[{id:'servis-'+id.split('-')[1],tagCodes:source.tag_codes,note:'Tag kodu kullanıcı test kaydında açıkça verilmiştir; her test bağımsız rota grubudur.'}],
    corridorIntervals:projection?.visits.filter(v=>v.areaType==='corridor'&&v.exitedAt!==null).map(v=>({regionId:v.areaId,from:v.enteredAt,to:v.exitedAt}))??[],
    note:'Kaynak source.json içinde değişmez tutulur. Z UTC; yerel gösterim Europe/Istanbul. Oda ziyaretleri arasındaki süre koridor; katı ve ±2 sn sınır toleranslı sonuç. Geçmiş DB girdileri PDOP filtresinden geçmiş olabilir; DB sonrası filtreyi kapatmak elenmiş paketleri geri getirmez.'};
  try{await writeFile(datasetDir(id)+'/truth.json',JSON.stringify(truth,null,2)+'\n',{flag:'wx'});}
  catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
    if(JSON.stringify(JSON.parse(await readFile(datasetDir(id)+'/truth.json','utf8')))!==JSON.stringify(truth))throw Error('Mevcut truth farklı; üzerine yazılmaz');}
  const candidates=await listCandidates(id);
  const tags=await queryPostgres(`SELECT tag_code,COALESCE(display_name,tag_name,tag_code) AS name FROM tags WHERE upper(trim(tag_code))=${q(source.tag_id)}`);
  const from=new Date(Date.parse(source.started_at)-30000).toISOString(),to=new Date(Date.parse(source.ended_at)+60000).toISOString();
  const filter=`tag_code=${q(source.tag_id)} AND published_at BETWEEN ${q(from)}::timestamptz AND ${q(to)}::timestamptz`;
  const versions=await queryPostgres(`SELECT engine_version,config_version,map_id,count(*)::text AS count FROM tag_room_decisions WHERE ${filter} GROUP BY engine_version,config_version,map_id`);
  const decisions=await queryPostgres(`SELECT id::text,measured_at::text,published_at::text,engine_version,config_version,map_id,state,region_id,event_type,reason_codes::text,payload::text FROM tag_room_decisions WHERE ${filter} ORDER BY published_at,id`);
  const pdop=hasPdop?await queryPostgres(`SELECT count(*)::text AS rows,count(pdop)::text AS present,min(pdop)::text AS minimum,max(pdop)::text AS maximum,count(*) FILTER(WHERE pdop>20)::text AS above_20 FROM tag_location_history WHERE tag_code=${q(source.tag_id)} AND created_at BETWEEN ${q(from)}::timestamptz AND ${q(to)}::timestamptz`):[];
  await writeFile(dir+'/'+id+'-audit.json',JSON.stringify({session,projection,candidates,tags,hasPdop,pdop,versions,decisions},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({testId:id,candidates,tags,hasPdop,pdop,versions,decisionCount:decisions.length},null,2));
}
