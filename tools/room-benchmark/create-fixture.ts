import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { compileRegionsConfig } from '../../src/server/regionEngine/configLoader';
import type { RegionsConfig } from '../../src/features/regions/types/region.types';
import { inspectRows, datasetDir } from './importer';
import { sha256, type Manifest, type RawRow, type Truth } from './model';

const id='test-00000000-0000-0000-0000-000000000001';
const config=compileRegionsConfig(JSON.parse(await readFile('config/maps/spor-koridor/regions.json','utf8')) as RegionsConfig);
const start=Date.parse('2026-09-24T10:00:00.000Z');
const at=(offset:number)=>new Date(start+offset).toISOString();
const r3=config.regions.find(r=>r.id==='room-03')!.roomCenter;
const r5=config.regions.find(r=>r.id==='room-05')!.roomCenter;
const truth:Truth={testId:id,timezone:'Europe/Istanbul',revision:1,revisionReason:'Anonim deterministik fixture',test:{from:at(5000),to:at(25000)},
  visits:[{roomId:'room-03',from:at(7000),to:at(13500)},{roomId:'room-05',from:at(17000),to:at(24000)}],groups:[{id:'example-route',tagCodes:['ANON-A','ANON-B']}]};
const rows:RawRow[]=[];let n=1;
for (const [tag,xshift] of [['ANON-A',0],['ANON-B',0.15]] as const) {
  for (const [t,point] of [[1000,r3],[3000,r3],[5000,r3],[7000,r3],[9000,r3],[11000,r3],[16000,r5],[18000,r5],[20000,r5],[22000,r5]] as const)
    rows.push({id:String(n++),tag_code:tag,x:point.x+xshift,y:point.y,created_at:at(t),received_at:at(t+120),quality:0.95,map_id:'spor-koridor',zone_id:null,zone_name:null});
}
rows.sort((a,b)=>Date.parse(a.received_at!)-Date.parse(b.received_at!)||Number(a.id)-Number(b.id));
const raw=Buffer.from(rows.map(r=>JSON.stringify(r)).join('\n')+'\n'),sha=await sha256(raw),quality=inspectRows(rows);
const manifest:Manifest={testId:id,source:'ANONİM SENTETİK FİXTURE; gerçek saha testi değildir',timezone:'Europe/Istanbul',importedAt:'2026-09-24T00:00:00.000Z',warmupMs:5000,observationMs:70000,
  selectedTags:['ANON-A','ANON-B'],candidateTags:{'ANON-A':10,'ANON-B':10},rowCount:rows.length,sha256:sha,timing:'exact',mapIds:{'spor-koridor':20},quality,
  caveat:'Sadece benchmarkın çalıştığını göstermek için deterministik anonim fixture.'};
const dir=datasetDir(id);await mkdir(dir,{recursive:true});
for(const [name,content] of [['truth.json',JSON.stringify(truth,null,2)+'\n'],['raw.jsonl',raw],['manifest.json',JSON.stringify(manifest,null,2)+'\n']] as const)
  await writeFile(path.join(dir,name),content);
console.log(dir);
