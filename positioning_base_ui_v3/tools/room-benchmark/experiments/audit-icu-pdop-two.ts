import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {queryPostgres} from '../../../src/server/postgresClient';
import {projectSession,type TestSession} from '../../../src/features/roomTests/services/roomTestModel';
import {datasetDir,listCandidates,importTest} from '../importer';
import {sha256} from '../model';
const ids=['test-36f6f20f-65cb-49f4-b704-71912f20c01d','test-4255236f-db12-4a1c-bc09-5e11c51d5d2a'];
const dir='tools/room-benchmark/reports/yogun-bakim-pdop-two-20261013';
const q=(s:string)=>`'${s.replaceAll("'","''")}'`;
await mkdir(dir,{recursive:true});
const protectedPaths=execFileSync('git',['ls-files'],{encoding:'utf8'}).trim().split('\n').filter(p=>!p.startsWith('tools/room-benchmark/'));
const hashes:Record<string,string>={};
for(const p of new Set(protectedPaths))hashes[p]=await sha256(await readFile(p));
for(const [file,content] of [['source-hashes-before.json',JSON.stringify(hashes,null,2)+'\n'],['git-status-before.txt',execFileSync('git',['status','--short'],{encoding:'utf8'})]]){
  try {await writeFile(dir+'/'+file,content,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
}
for(const id of ids){
  const source=JSON.parse(await readFile(datasetDir(id)+'/source.json','utf8'));
  const rooms=source.rooms as {room:string;entered_at:string;exited_at:string;duration_seconds:number}[];
  let last=Date.parse(source.started_at);
  for(const v of rooms){if(Date.parse(v.entered_at)<last||Date.parse(v.exited_at)<=Date.parse(v.entered_at)||Date.parse(v.exited_at)>Date.parse(source.ended_at)||Math.abs((Date.parse(v.exited_at)-Date.parse(v.entered_at))/1000-v.duration_seconds)>0.000001)throw Error('Kaynak aralık/süre hatası');last=Date.parse(v.exited_at);}
  const sessions=await queryPostgres(`SELECT payload::text FROM room_test_sessions WHERE id=${q(id)}`);
  const session=sessions[0]?.payload?JSON.parse(sessions[0].payload) as TestSession:null,projection=session?projectSession(session):null;
  if(projection){const visits=projection.visits.filter(v=>v.areaType==='room');
    if(projection.startedAt!==source.started_at||projection.endedAt!==source.ended_at||visits.length!==rooms.length||visits.some((v,i)=>v.areaId!==rooms[i].room||v.enteredAt!==rooms[i].entered_at||v.exitedAt!==rooms[i].exited_at))throw Error('DB oturumu verilen testle uyuşmuyor');}
  const truth={testId:id,testName:'Yoğun Bakım — '+source.test_name+' — '+id.split('-')[1],site:'Necmettin Hastanesi — Yoğun Bakım',timezone:'Europe/Istanbul',revision:1,
    revisionReason:'Kullanıcının UTC milisaniyeli oda ziyaretleri ve açık tag kodu korunarak eklendi; test oturumu SELECT ile kontrol edildi.',
    test:{from:source.started_at,to:source.ended_at},visits:rooms.map(v=>({roomId:v.room,from:v.entered_at,to:v.exited_at})),
    groups:[{id:'icu-'+id.split('-')[1],tagCodes:source.tag_codes,note:'Kullanıcının açık tag kodu; eşzamanlı diğer test farklı tag ve bağımsız rotadır.'}],
    note:'Z saatleri UTC olarak korunur, yerel gösterim Europe/Istanbul. Oda aralıkları arasındaki süre koridor. Ham DB geçmişi eksiksiz canlı akış değildir; PDOP nedeniyle kalıcı kayıt öncesi elenen paketler geri getirilemez.'};
  await writeFile(datasetDir(id)+'/truth.json',JSON.stringify(truth,null,2)+'\n',{flag:'wx'});
  const candidates=await listCandidates(id);
  const tags=await queryPostgres(`SELECT tag_code,COALESCE(display_name,tag_name,tag_code) AS name FROM tags WHERE upper(trim(tag_code))=${q(source.tag_id)}`);
  const from=new Date(Date.parse(source.started_at)-30000).toISOString(),to=new Date(Date.parse(source.ended_at)+60000).toISOString();
  const filter=`tag_code=${q(source.tag_id)} AND published_at BETWEEN ${q(from)}::timestamptz AND ${q(to)}::timestamptz`;
  const versions=await queryPostgres(`SELECT engine_version,config_version,map_id,count(*)::text AS count FROM tag_room_decisions WHERE ${filter} GROUP BY engine_version,config_version,map_id`);
  const decisions=await queryPostgres(`SELECT id::text,measured_at::text,published_at::text,engine_version,config_version,map_id,state,region_id,event_type,reason_codes::text,payload::text FROM tag_room_decisions WHERE ${filter} ORDER BY published_at,id`);
  const mapRows=await queryPostgres(`SELECT map_id,count(*)::text AS count FROM tag_location_history WHERE tag_code=${q(source.tag_id)} AND created_at BETWEEN ${q(from)}::timestamptz AND ${q(to)}::timestamptz GROUP BY map_id`);
  await writeFile(dir+'/'+id+'-audit.json',JSON.stringify({session,projection,candidates,tags,versions,decisions,mapRows},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({testId:id,candidates,tags,versions,mapRows,decisionCount:decisions.length}));
  if(!(source.tag_id in candidates))throw Error('Verilen tagın ham verisi yok; başka tag atanmaz');
  const manifest=await importTest(id,source.tag_codes);
  console.log(JSON.stringify({testId:id,rows:manifest.rowCount,maps:manifest.mapIds,quality:manifest.quality,pdop:manifest.pdop,sha256:manifest.sha256}));
}
