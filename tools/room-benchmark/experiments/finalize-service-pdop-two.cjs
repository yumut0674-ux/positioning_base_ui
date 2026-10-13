const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root='tools/room-benchmark/reports/servis-pdop-two-latest-20261013';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const inline=s=>escape(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');
function body(md){
  let table=false;const out=[];
  for(const line of md.trimEnd().split('\n')){
    if(line.startsWith('|')){
      if(/^\|[-:| ]+\|$/.test(line))continue;
      if(!table){out.push('<div class="table"><table>');table=true;}
      out.push('<tr>'+line.slice(1,-1).split('|').map(s=>'<td>'+inline(s.trim())+'</td>').join('')+'</tr>');continue;
    }
    if(table){out.push('</table></div>');table=false;}
    if(!line.trim())continue;
    const heading=line.match(/^(#{1,3}) /);
    out.push(heading?`<h${heading[1].length}>${inline(line.slice(heading[0].length))}</h${heading[1].length}>`:`<p>${inline(line)}</p>`);
  }
  if(table)out.push('</table></div>');return out.join('\n');
}
(async()=>{
  const original=JSON.parse(await fs.readFile('tools/room-benchmark/reports/servis-pdop-two-20261013/source-hashes-before.json','utf8'));
  const latest=JSON.parse(await fs.readFile(root+'/source-hashes-before.json','utf8'));
  const changes=[];
  for(const [file,before] of Object.entries(original)){
    let after;try{after=hash(await fs.readFile(file));}catch(e){if(e.code!=='ENOENT')throw e;after='missing';}
    if(after!==before)changes.push({path:file,before,after});
  }
  const critical=[];
  for(const [file,before] of Object.entries(latest)){
    const after=hash(await fs.readFile(file));critical.push({path:file,before,after,unchanged:before===after});
  }
  if(critical.some(c=>!c.unchanged))throw new Error('Güncel replay sonrası motor/config/PDOP kaynağı değişti; sonuç yeniden doğrulanmalı');
  const study=JSON.parse(await fs.readFile(root+'/study.json','utf8'));
  const datasets=[];
  for(const report of study.reports){
    const dir=path.join('tools/room-benchmark/datasets',report.testId);
    const raw=hash(await fs.readFile(dir+'/raw.jsonl')),truth=hash(await fs.readFile(dir+'/truth.json'));
    if(raw!==report.dataset.sha256||truth!==report.dataset.truthSha256)throw new Error('Veri/truth değişmiş');
    datasets.push({testId:report.testId,rawSha256:raw,truthSha256:truth,unchangedSinceReplay:true});
  }
  const verification={scope:'Only tools/room-benchmark files were written by this benchmark task',
    gitCommitNow:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),gitStatusNow:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim(),
    criticalSources:critical,initialOutsideFileCount:Object.keys(original).length,concurrentOutsideChanges:changes,
    concurrentChangesCaveat:'Initial/latest source checks capture separate snapshots. Production PDOP/map panel work and commit changed concurrently; those files were read and preserved by this task. Initial all-source equality is not claimed.',
    datasets,deterministicProfiles:study.deterministic,
    tests:{total:18,passed:17,failed:0,skipped:1,skipReason:'DB-writing PDOP integration test disabled with TRACKING_PDOP_DATABASE_TEST=0'},
    typecheck:{scoped:'passed',project:'failed',error:"tools/room-benchmark/reports/ui-experience-5c71fd2a-20261013/analyze.ts(133,23): TS2783 roomId specified more than once (existing report, preserved)"},
    isolation:{replayEngine:'imported active RegionPositionEngine; in-memory publish; injected virtual clock; auto timer disabled',
      noControllerOrTrackingBufferInReplay:true,noListenerOrLiveSseStarted:true,noLiveApiReplay:true,noDatabaseWrite:true,databaseOperations:'SELECT only for import/audit',
      noServerRestartOrStop:true,allStartedBenchmarkCommandsTerminated:true}};
  await fs.writeFile(root+'/verification.json',JSON.stringify(verification,null,2)+'\n',{flag:'wx'});
  const md=await fs.readFile(root+'/interpretation.md','utf8'),details=await fs.readFile(root+'/analysis.md','utf8');
  const html='<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Servis — PDOP ve oda tespiti, 13 Ekim 2026</title><style>body{font:16px system-ui;line-height:1.55;background:#f3f6f8;color:#172a3a;max-width:1160px;margin:30px auto;padding:0 18px}main{background:white;padding:28px;border-radius:14px}h1{font-size:27px}h2{margin-top:32px;color:#174b64}h3{font-size:20px}a{color:#085b9a}code{background:#edf2f5;padding:2px 4px;overflow-wrap:anywhere}.table{overflow:auto;margin:20px 0}table{border-collapse:collapse;font-size:14px;width:100%}td{padding:9px;border:1px solid #d2dbe2;vertical-align:top}tr:first-child{font-weight:700;background:#e8f1f5}details{margin-top:25px}summary{cursor:pointer;font-weight:700;font-size:20px}nav{margin-bottom:25px}strong{color:#174b64}@media print{body{background:white}main{padding:0}.table{overflow:visible}}</style></head><body><main><nav><a href="interpretation.md">Yorum Markdown</a> · <a href="analysis.md">Tüm ziyaretler</a> · <a href="study.json">Deney JSON</a> · <a href="verification.json">Doğrulama</a> · <a href="../servis-344ab34d-pdop-current-latest-20261013/report.html">11:17 standart rapor</a> · <a href="../servis-9a7debf0-pdop-current-latest-20261013/report.html">11:39 standart rapor</a></nav>'+body(md)+'<details open><summary>Tüm 19 ziyaret ve eşik tabloları</summary>'+body(details)+'</details></main></body></html>';
  for(const link of ['interpretation.md','analysis.md','study.json','verification.json','../servis-344ab34d-pdop-current-latest-20261013/report.html','../servis-9a7debf0-pdop-current-latest-20261013/report.html'])await fs.access(path.resolve(root,link));
  await fs.writeFile(root+'/analysis.html',html,{flag:'wx'});
  console.log(JSON.stringify({html:root+'/analysis.html',criticalSourcesUnchanged:critical.length,outsideFilesChecked:Object.keys(original).length,concurrentOutsideChanges:changes.map(c=>c.path),datasetsVerified:datasets.length,tableCount:(html.match(/<table>/g)||[]).length}));
})().catch(error=>{console.error(error);process.exitCode=1;});
