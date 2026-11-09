import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {queryPostgres} from '../../../src/server/postgresClient';
import {projectSession,type TestSession} from '../../../src/features/roomTests/services/roomTestModel';
import {sha256} from '../model';

const id='test-f93aa2c0-e0fc-4130-b0c5-3d1207fd120a';
const dir='tools/room-benchmark/reports/servis-f93aa2c0-audit-20261013';
const quote=(s:string)=>`'${s.replaceAll("'","''")}'`;
await mkdir(dir,{recursive:true});
const paths=execFileSync('git',['ls-files'],{encoding:'utf8'}).trim().split('\n').filter(p=>!p.startsWith('tools/room-benchmark/'));
paths.push('src/server/regionEngine/StepDistanceFilter.ts');
const protectedFiles:Record<string,string>={};
for(const file of new Set(paths)){
  try{protectedFiles[file]=await sha256(await readFile(file));}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
}
try {await writeFile(dir+'/protected-files-before.json',JSON.stringify(protectedFiles,null,2)+'\n',{flag:'wx'});}
catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
const sessionRows=await queryPostgres(`SELECT payload::text FROM room_test_sessions WHERE id=${quote(id)}`);
const session=sessionRows[0]?.payload?JSON.parse(sessionRows[0].payload) as TestSession:null;
const projection=session?projectSession(session):null;
const tags=await queryPostgres(`SELECT tag_code,COALESCE(display_name,tag_name,tag_code) AS name FROM tags WHERE tag_code='9C76E417B4CB5ECF'`);
await writeFile(dir+'/session-audit.json',JSON.stringify({session,projection,tags},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({tags,session:session?{configHash:session.configHash,revision:session.revision,version:session.version}:null,
  projection:projection?{status:projection.status,startedAt:projection.startedAt,endedAt:projection.endedAt,tagCodes:projection.tagCodes,tagVerified:projection.tagVerified,
    segments:projection.segments,visits:projection.visits.map(v=>({room:v.areaId,from:v.enteredAt,to:v.exitedAt,mapId:v.mapId}))}:null},null,2));
