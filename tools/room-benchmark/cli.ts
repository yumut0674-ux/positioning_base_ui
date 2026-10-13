import path from 'node:path';
import { ensureCatalog, importTest, listCandidates } from './importer';
import { runTest } from './replay';
import { compare, markdown, readRun, writeReport } from './report';

const [command,...args]=process.argv.slice(2);
const option=(key:string,fallback?:string):string|undefined=>{const index=args.indexOf(`--${key}`);return index<0?fallback:args[index+1];};
const number=(key:string,fallback:number):number=>{const value=Number(option(key,String(fallback)));if(!Number.isFinite(value)||value<0)throw new Error(`Geçersiz ${key}`);return value;};
try {
  if(command==='init-truth') {await ensureCatalog();console.log('Dokuz truth.json hazır. Var olanlar korunur.');}
  else if(command==='candidates') {const id=args[0];if(!id)throw new Error('test ID gerekli');console.log(JSON.stringify(await listCandidates(id,number('warmup-ms',30000),number('observation-ms',60000)),null,2));}
  else if(command==='import') {const id=args[0],tags=option('tags')?.split(',').map(t=>t.trim()).filter(Boolean)??[];if(!id)throw new Error('test ID gerekli');
    const candidates=await listCandidates(id,number('warmup-ms',30000),number('observation-ms',60000));console.log('Olası tag ve paket sayısı:',JSON.stringify(candidates));
    console.log(JSON.stringify(await importTest(id,tags,number('warmup-ms',30000),number('observation-ms',60000)),null,2));}
  else if(command==='replay') {const id=args[0];if(!id)throw new Error('test ID gerekli');const configPath=path.resolve(option('config','config/maps/spor-koridor/regions.json')!);
    const run=await runTest(id,{configPath,tickMs:number('tick-ms',1000),sampleMs:number('sample-ms',250),boundaryToleranceMs:number('tolerance-ms',2000),
      ...(args.includes('--pdop-off')?{pdopEnabled:false}:{}),...(option('pdop-max')!==undefined?{pdopMax:number('pdop-max',20)}:{})});
    const dir=await writeReport(run,option('run-id'));console.log(dir);console.log(markdown(run));}
  else if(command==='report') {console.log(markdown(await readRun(args[0])));}
  else if(command==='compare') {console.log(compare(await readRun(args[0]),await readRun(args[1])));}
  else throw new Error('Komutlar: init-truth | candidates <test-id> | import <test-id> --tags TAG1,TAG2 | replay <test-id> [--config ...] | report <report.json> | compare <eski.json> <yeni.json>');
} catch(error) {console.error((error as Error).message);process.exitCode=1;}
