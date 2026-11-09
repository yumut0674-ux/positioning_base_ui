const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const runId=process.argv[2];
if(!runId||!/^[a-zA-Z0-9_-]+$/.test(runId))throw Error('Usage: node tools/room-benchmark/experiments/prepare-icu-friday.cjs RUN-ID');
const root=path.resolve('tools/room-benchmark/reports',runId);
(async()=>{
  await fs.mkdir(root,{recursive:false});
  const commit=execFileSync('git',['rev-parse','4e2136f'],{encoding:'utf8'}).trim();
  const initial={};
  for(const file of execFileSync('git',['ls-files','-z']).toString().split('\0').filter(f=>f&&!f.startsWith('tools/room-benchmark/'))){
    try{initial[file]=hash(await fs.readFile(file));}catch(e){if(e.code!=='ENOENT')throw e;initial[file]='missing';}
  }
  await fs.writeFile(path.join(root,'source-hashes-before.json'),JSON.stringify(initial,null,2)+'\n',{flag:'wx'});
  await fs.writeFile(path.join(root,'git-status-before.txt'),execFileSync('git',['status','--short'],{encoding:'utf8'}),{flag:'wx'});
  const archivedAnalysis=JSON.parse(await fs.readFile('tools/room-benchmark/reports/necmettin-yogun-bakim-f6d295ed-20261009/analysis.json','utf8'));
  const archivedRun=JSON.parse(await fs.readFile('tools/room-benchmark/reports/necmettin-yogun-bakim-f6d295ed-20261009/report.json','utf8'));
  const snapshot=path.join(root,'historical-source',commit);
  const files=['src/server/regionEngine/RegionPositionEngine.ts','src/server/regionEngine/configLoader.ts','src/server/regionEngine/geometry.ts','src/server/regionEngine/types.ts','src/features/regions/config/regionInferenceSettings.ts','src/features/regions/types/region.types.ts','config/regions.json','config/maps/necmettin-yogun-bakim/regions.json'];
  const sources=[];
  for(const file of files){
    const bytes=execFileSync('git',['show',commit+':'+file],{maxBuffer:8*1024*1024});
    const destination=path.join(snapshot,file+(file.endsWith('.ts')?'.snapshot':''));await fs.mkdir(path.dirname(destination),{recursive:true});
    await fs.writeFile(destination,bytes,{flag:'wx'});
    const digest=hash(bytes),basename=path.basename(file),recorded=archivedAnalysis.engineSources[basename];
    if(recorded)assert.equal(digest,recorded,'Historical source does not match Friday benchmark: '+file);
    sources.push({path:file,storedPath:destination,sha256:digest,gitBlob:execFileSync('git',['rev-parse',commit+':'+file],{encoding:'utf8'}).trim(),...(recorded?{matchesFridayRecordedHash:true}:{})});
  }
  const fridayInitial=await fs.readFile('tools/room-benchmark/reports/necmettin-yogun-bakim-f6d295ed-entry-exit-study-20261009/config.snapshot.json');
  assert.equal(hash(fridayInitial),archivedRun.config.sha256,'Friday initial config snapshot differs from archived report');
  await fs.writeFile(path.join(root,'friday-initial-config.json'),fridayInitial,{flag:'wx'});
  const current=await fs.readFile('config/maps/necmettin-yogun-bakim/regions.json');
  await fs.writeFile(path.join(root,'current-config.json'),current,{flag:'wx'});
  const pdop=await fs.readFile('config/maps/necmettin-yogun-bakim/tracking-filter.json');
  await fs.writeFile(path.join(root,'current-tracking-filter.json'),pdop,{flag:'wx'});
  const metadata={runId,root,historicalCommit:commit,historicalCommitTime:execFileSync('git',['show','-s','--format=%aI',commit],{encoding:'utf8'}).trim(),historicalEngineVersion:'room-evidence-9',historicalSourceRoot:snapshot,sources,
    historicalEvidence:{archivedReport:'tools/room-benchmark/reports/necmettin-yogun-bakim-f6d295ed-20261009/report.json',archivedAnalysis:'tools/room-benchmark/reports/necmettin-yogun-bakim-f6d295ed-20261009/analysis.json',archivedReportGit:archivedRun.git,recordedDatabaseVersions:archivedAnalysis.historicalVersions,matchedEngineLoaderAndGeometry:true,
      caveat:'Friday benchmark ran on a dirty checkout based on 659d846. Its recorded engine/configLoader/geometry SHA-256 exactly match commit 4e2136f; using 659d846 alone would run a different engine without ICU regions.'},
    initialConfigSha256:hash(fridayInitial),currentConfigSha256:hash(current),currentTrackingFilterSha256:hash(pdop),currentEngineSha256:hash(await fs.readFile('src/server/regionEngine/RegionPositionEngine.ts')),
    archivePolicy:'Unmodified Git blobs, immutable experiment snapshot only. No maintained engine fork; benchmark default continues importing the active engine. Type-only trackingBuffer references are erased and that live module is not archived or started.',
    currentGit:{commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--short'],{encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim()}};
  await fs.writeFile(path.join(root,'provenance.json'),JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});
  await require('./materialize-icu-friday.cjs').materialize(root,metadata);
  console.log(JSON.stringify({root,historicalCommit:commit,matchedFridaySources:sources.filter(s=>s.matchesFridayRecordedHash).length,initialConfigSha256:metadata.initialConfigSha256,currentConfigSha256:metadata.currentConfigSha256}));
})().catch(e=>{console.error(e);process.exitCode=1;});
