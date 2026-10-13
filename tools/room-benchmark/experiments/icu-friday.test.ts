import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {Server} from 'node:net';
import {RegionPositionEngine} from '../../../src/server/regionEngine/RegionPositionEngine';
import {compileRegionsConfig} from '../../../src/server/regionEngine/configLoader';
import {readDataset} from '../importer';
import {replayRows,type ReplayEngineFactory} from '../replay';
import {sha256} from '../model';
const root=path.resolve(process.env.ICU_FRIDAY_REPORT??'tools/room-benchmark/reports/yogun-bakim-friday-vs-current-20261013');
const options={tickMs:1000,sampleMs:250,boundaryToleranceMs:2000,warmupMs:30000,observationMs:60000,pdopEnabled:true,pdopMax:70};

test('engine factory preserves default replay and virtual timestamps without timers/listeners',async()=>{
  const data=await readDataset('test-36f6f20f-65cb-49f4-b704-71912f20c01d');
  const config=compileRegionsConfig(JSON.parse(await readFile(path.join(root,'current-config.json'),'utf8')));
  const before=replayRows(data.rows,data.truth,config,options);
  const originalTimer=globalThis.setInterval,originalListen=Server.prototype.listen;
  let created=0,disabled=0;
  const factory:ReplayEngineFactory=(publish,interval,now)=>{
    created++;
    const engine=new RegionPositionEngine(publish,interval,now,false);
    return {enable:c=>engine.enable(c),ingest:r=>engine.ingest(r),tick:()=>engine.tick(),disable:()=>{disabled++;engine.disable();}};
  };
  try{
    globalThis.setInterval=(()=>{throw Error('Automatic timer forbidden');}) as typeof setInterval;
    Server.prototype.listen=(()=>{throw Error('Live listener forbidden');}) as typeof originalListen;
    assert.deepEqual(replayRows(data.rows,data.truth,config,options,factory),before);
  }finally{globalThis.setInterval=originalTimer;Server.prototype.listen=originalListen;}
  assert.equal(created,1);assert.equal(disabled,1);
});

test('historical modules are Git blobs and original Friday decisions and scores reproduce',async()=>{
  const provenance=JSON.parse(await readFile(path.join(root,'provenance.json'),'utf8'));
  for(const source of provenance.sources)assert.equal(await sha256(await readFile(source.storedPath)),source.sha256);
  for(const output of provenance.transpilation.outputs)assert.equal(await sha256(await readFile(output.path)),output.sha256);
  const module=await import(pathToFileURL(path.join(provenance.historicalRuntimeRoot,'src/server/regionEngine/RegionPositionEngine.js')).href);
  const loader=await import(pathToFileURL(path.join(provenance.historicalRuntimeRoot,'src/server/regionEngine/configLoader.js')).href);
  const data=await readDataset('test-f6d295ed-38a9-4e8f-a8d2-f5f6ba4b1d06');
  const config=loader.compileRegionsConfig(JSON.parse(await readFile(path.join(root,'friday-initial-config.json'),'utf8')));
  const factory:ReplayEngineFactory=(publish,interval,now)=>new module.RegionPositionEngine(publish,interval,now,false);
  const originalTimer=globalThis.setInterval,originalListen=Server.prototype.listen;
  let replay;
  try{
    globalThis.setInterval=(()=>{throw Error('Historical automatic timer forbidden');}) as typeof setInterval;
    Server.prototype.listen=(()=>{throw Error('Historical listener forbidden');}) as typeof originalListen;
    replay=replayRows(data.rows,data.truth,config,{...options,pdopEnabled:false},factory);
  }finally{globalThis.setInterval=originalTimer;Server.prototype.listen=originalListen;}
  const archived=JSON.parse(await readFile(provenance.historicalEvidence.archivedReport,'utf8'));
  const retain=(value:unknown)=>JSON.parse(JSON.stringify(value,(key,item)=>key==='pdop'||key==='evidence'?undefined:item));
  assert.equal(module.ROOM_ENGINE_VERSION,'room-evidence-9');
  assert.deepEqual(retain(replay.decisions),retain(archived.decisions));
  assert.deepEqual(retain(replay.metrics),retain(archived.metrics));
});
