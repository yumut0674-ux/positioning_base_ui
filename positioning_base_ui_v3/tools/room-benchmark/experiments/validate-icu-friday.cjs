const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const runId=process.argv[2];
if(!runId||!/^[a-zA-Z0-9_-]+$/.test(runId))throw Error('RUN-ID required');
const root=path.resolve('tools/room-benchmark/reports',runId);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
(async()=>{
  await fs.access(path.join(root,'study.json'));
  const tasks=[
    {name:'tests',args:['--import','tsx','--test','tools/room-benchmark/benchmark.test.ts','tools/room-benchmark/pdop.test.ts','tools/room-benchmark/experiments/icu-friday.test.ts','tests/trackingPdop.test.ts']},
    {name:'benchmark-typecheck',args:['node_modules/typescript/bin/tsc','-p','tools/room-benchmark/experiments/tsconfig.icu-friday.json','--noEmit']},
    {name:'project-typecheck',args:['node_modules/typescript/bin/tsc','--noEmit','--incremental','false']},
  ];
  const results={};
  for(const task of tasks){
    const run=spawnSync(process.execPath,task.args,{encoding:'utf8',env:{...process.env,TRACKING_PDOP_DATABASE_TEST:'0',ICU_FRIDAY_REPORT:root},maxBuffer:8*1024*1024});
    if(run.error)throw run.error;
    const output=(run.stdout??'')+(run.stderr??'');
    await fs.writeFile(path.join(root,task.name+'.log'),output);
    results[task.name]={command:'node '+task.args.join(' '),exitCode:run.status,log:task.name+'.log',...(task.name.includes('typecheck')?{diagnostics:output.trim()}:{}),
      ...(task.name==='tests'?Object.fromEntries(['tests','pass','fail','skipped'].map(name=>[name,Number(output.match(new RegExp('^# '+name+' (\\d+)$','m'))?.[1]??NaN)])):{})};
  }
  const sourceHashes={};
  for(const file of ['src/server/regionEngine/RegionPositionEngine.ts','src/server/regionEngine/configLoader.ts','src/server/regionEngine/geometry.ts','config/maps/necmettin-yogun-bakim/regions.json','config/maps/necmettin-yogun-bakim/tracking-filter.json','tools/room-benchmark/replay.ts','tools/room-benchmark/score.ts','tools/room-benchmark/experiments/compare-icu-friday.ts','tools/room-benchmark/experiments/icu-friday.test.ts'])sourceHashes[file]=hash(await fs.readFile(file));
  await fs.writeFile(path.join(root,'validation-results.json'),JSON.stringify({results,sourceHashes,dbWritingIntegrationDisabled:true},null,2)+'\n');
  console.log(JSON.stringify(results));
  if(results.tests.exitCode!==0||results['benchmark-typecheck'].exitCode!==0)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
