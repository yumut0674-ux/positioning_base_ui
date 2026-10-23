import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {compileRegionsConfig} from '../../../src/server/regionEngine/configLoader';
import {readDataset} from '../importer';
import {sha256} from '../model';
import {replayRows} from '../replay';
const dir=path.resolve(process.argv[2]);
const summary=JSON.parse(await readFile(path.join(dir,'summary.json'),'utf8'));
for(const [file,hash] of Object.entries(summary.protectedBefore))assert.equal(await sha256(await readFile(file)),hash,'Changed source '+file);
for(const t of summary.tests)for(const profile of process.argv.slice(3)){
  const trial=t.trials.find((x:any)=>x.profile===profile);assert.ok(trial,'Profile missing');
  const {truth,rows,manifest,truthSha256}=await readDataset(t.testId);
  assert.equal(manifest.sha256,t.dataset.sha256);assert.equal(truthSha256,t.dataset.truthSha256);
  const bytes=await readFile(path.join(dir,trial.configFile));assert.equal(await sha256(bytes),trial.configSha256);
  const result=replayRows(rows,truth,compileRegionsConfig(JSON.parse(bytes.toString())),t.simulation);
  assert.equal(await sha256(Buffer.from(JSON.stringify(result))),trial.summary.outputSha256,'Selected replay changed');
  await writeFile(path.join(dir,t.testId+'-'+profile+'.json'),JSON.stringify({metadata:{engine:summary.engine,git:summary.git,sourceHashes:summary.sourceHashes,
    sourceConfig:t.sourceConfig,config:{sha256:trial.configSha256,version:trial.configVersion,parameters:trial.parameters},dataset:t.dataset,simulation:t.simulation},...result},null,2)+'\n',{flag:'wx'});
}
console.log('Selected reports reproduced and saved');
