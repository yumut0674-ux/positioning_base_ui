const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const ts=require('typescript');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
/** Preserve exact Git bytes as .snapshot files; compiled JS stays out of project TS globs. */
async function materialize(root,provenance){
  root=path.resolve(root);
  const runtime=path.join(root,'historical-runtime',provenance.historicalCommit),outputs=[];
  for(const source of provenance.sources){
    const original=path.resolve(provenance.historicalSourceRoot,source.path);
    assert.ok(original.startsWith(root+path.sep),'Historical file must be inside this experiment');
    const stored=source.path.endsWith('.ts')?original+'.snapshot':original;
    let bytes;
    try{bytes=await fs.readFile(stored);}catch(e){
      if(e.code!=='ENOENT')throw e;
      bytes=await fs.readFile(original);assert.equal(hash(bytes),source.sha256);
      await fs.rename(original,stored);
    }
    assert.equal(hash(bytes),source.sha256,'Git snapshot changed: '+source.path);
    source.storedPath=stored;
    const destination=path.join(runtime,source.path.replace(/\.ts$/,'.js'));
    await fs.mkdir(path.dirname(destination),{recursive:true});
    const output=source.path.endsWith('.ts')?Buffer.from(ts.transpileModule(bytes.toString('utf8'),{
      fileName:source.path,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true,isolatedModules:true},
    }).outputText):bytes;
    try{await fs.writeFile(destination,output,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.equal(hash(await fs.readFile(destination)),hash(output));}
    outputs.push({logicalSource:source.path,path:destination,sha256:hash(output),sourceSha256:source.sha256});
  }
  const packageBytes='{"private":true,"type":"commonjs"}\n';
  try{await fs.writeFile(path.join(runtime,'package.json'),packageBytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.equal(await fs.readFile(path.join(runtime,'package.json'),'utf8'),packageBytes);}
  provenance.historicalRuntimeRoot=runtime;
  provenance.transpilation={typescriptVersion:ts.version,target:'ES2022',module:'CommonJS',esModuleInterop:true,outputs,
    reason:'Exact Git snapshots are stored with a .snapshot suffix so the root project typecheck does not mix historical type-only aliases with current types. Unmodified source is transpiled, not manually adapted.'};
  await fs.writeFile(path.join(root,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
  return provenance;
}
module.exports={materialize};
if(require.main===module){
  const runId=process.argv[2];if(!runId||!/^[a-zA-Z0-9_-]+$/.test(runId))throw Error('RUN-ID required');
  const root=path.resolve('tools/room-benchmark/reports',runId);
  fs.readFile(path.join(root,'provenance.json'),'utf8').then(JSON.parse).then(p=>materialize(root,p)).then(p=>console.log(JSON.stringify({runtime:p.historicalRuntimeRoot,sourceCount:p.sources.length,typescript:p.transpilation.typescriptVersion}))).catch(e=>{console.error(e);process.exitCode=1;});
}
