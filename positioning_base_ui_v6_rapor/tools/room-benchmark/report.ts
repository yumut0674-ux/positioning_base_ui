import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Run } from './replay';
import { round } from './model';
const root=path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/,''));
const pct=(n:number,d:number)=>d?`${round(n*100/d)}%`:'—';
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function htmlBody(md:string):string {
  let table=false;
  const out:string[]=[];
  for (const line of md.trimEnd().split('\n')) {
    if (line.startsWith('|')) {
      if (/^\|[-:| ]+\|$/.test(line)) continue;
      if (!table) {out.push('<table>');table=true;}
      const cells=line.slice(1,-1).split('|').map(c=>`<td>${escape(c.trim())}</td>`).join('');
      out.push(`<tr>${cells}</tr>`);continue;
    }
    if(table){out.push('</table>');table=false;}
    if(!line.trim())continue;
    const level=line.match(/^(#{1,3}) /);
    out.push(level?`<h${level[1].length}>${escape(line.slice(level[0].length))}</h${level[1].length}>`:`<p>${escape(line)}</p>`);
  }
  if(table)out.push('</table>');
  return out.join('\n');
}
export function markdown(run:Run):string {
  const m=run.metrics, out=[`# Oda benchmarkı: ${run.testId}`,'',
    `Motor: ${run.engineVersion} · commit: ${run.git.commit} · kirli: ${run.git.dirty}`,
    `Harita: ${run.config.context} · ${run.config.path} · configVersion ${run.config.version} · SHA-256 ${run.config.sha256}`,
    `Veri: ${run.dataset.source} · SHA-256 ${run.dataset.sha256} · ${run.dataset.rowCount} satır · zamanlama ${run.dataset.timing}`,
    `Truth: revizyon ${run.dataset.truthRevision} · SHA-256 ${run.dataset.truthSha256}`,
    `Simülasyon: tick ${run.simulation.tickMs} ms, örnek ${run.simulation.sampleMs} ms, sınır toleransı ±${run.simulation.boundaryToleranceMs} ms; aynı anda önce tick, sonra DB id`,
    `Ham dosyadaki paket: ${run.dataset.rowCount}; replay teslim aralığına düşen paket: ${run.preprocessing?run.preprocessing.pdop.knownValues+run.preprocessing.pdop.unknownValues:'eski raporda ayrı kaydedilmedi'}; üretilen motor kararı: ${run.decisions.length}`,
    '',`Genel doğru durum (oda + koridor): ${m.successPercent===null?'puanlanmadı':m.successPercent+'%'}`,
    `Yalnız gerçek oda aralıklarında doğru oda: ${m.roomOnlySuccessPercent===null?'puanlanmadı':m.roomOnlySuccessPercent+'%'} (doğrulanmış + tahmini; payda ${round(m.actualRoomMs/1000)} tag-saniye)`,
    `Puanlanmayan tag'lar: ${run.unscoredTags.join(', ')||'yok'}`,
    `Aday tag / paket sayısı: ${Object.entries(run.dataset.candidateTags).map(([tag,n])=>`${tag}: ${n}`).join(', ')}`,
    `Eksik received_at: ${run.dataset.quality.missingReceivedAt}; eksik kalite: ${run.dataset.quality.missingQuality}; eksik koordinat: ${run.dataset.quality.missingCoordinates}; zaman anomalisi: ${run.dataset.quality.timingAnomalies}; büyük boşluk: ${run.dataset.quality.largeGaps.length}; reddedilen ölçüm: ${run.decisions.filter(d=>d.eventType==='MEASUREMENT_REJECTED').length}`,
    '','## Oda / tag sonuçları','',
    '| Tag | Oda | Katı doğrulanmış | Katı tahmini | Yanlış oda | Sınır toleranslı başarı |','|---|---|---:|---:|---:|---:|'];
  if(m.successPercent===null) out.splice(out.indexOf('## Oda / tag sonuçları'),0,'Puanlama nedeni: truth.json içindeki groups boş veya doğrulanmış tag yok. Motor kararları üretildi; oda doğruluğu hesaplanmadı.','');
  const pdop=run.preprocessing?.pdop;
  if(pdop)out.splice(out.indexOf('## Oda / tag sonuçları'),0,
    `PDOP ön filtresi: ${pdop.enabled?'açık':'kapalı'}, eşik ${pdop.limit}; bilinen ${pdop.knownValues}, eksik/bilinmeyen ${pdop.unknownValues}, motor öncesi elenen ${pdop.rejected.length}. NULL/eksik değer kalite başarısı sayılmaz; üretim kuralına göre kabul edilir.`,
    `PDOP kuralı: ${pdop.sourcePath??'shared/tracking/pdop'} · SHA-256 ${pdop.sourceSha256??'replayRows tanı çıktısında yok'}. ${pdop.caveat??'DB öncesinde elenmiş paketlerin etkisi bu arşivden ölçülemez.'}`,
    `PDOP ayar kaynağı: ${pdop.settingsSource??'doğrudan replay ayarı'} · ${pdop.settingsPath??'—'} · SHA-256 ${pdop.settingsSha256??'—'}.`,'');
  for(const [tag,v] of Object.entries(m.tags)) for(const [room,c] of Object.entries(v.rooms)) {
    const t=v.roomsTolerant[room];
    out.push(`| ${tag} | ${room} | ${round(c.correctConfirmedMs/1000)} s | ${round(c.correctInferredMs/1000)} s | ${round(c.wrongRoomMs/1000)} s | ${t?pct(t.correctConfirmedMs+t.correctInferredMs,t.totalMs):'—'} |`);
  }
  out.push('','## Ziyaretler','','| Tag | No | Oda | Kaçırıldı | Giriş gecikmesi | Çıkış gecikmesi |','|---|---:|---|---|---:|---:|');
  for(const [tag,v] of Object.entries(m.tags)) for(const visit of v.visits as {index:number;roomId:string;missed:boolean;entryDelayMs:number|null;exitDelayMs:number|null}[])
    out.push(`| ${tag} | ${visit.index} | ${visit.roomId} | ${visit.missed?'evet':'hayır'} | ${visit.entryDelayMs===null?'—':round(visit.entryDelayMs/1000)+' s'} | ${visit.exitDelayMs===null?'—':round(visit.exitDelayMs/1000)+' s'} |`);
  out.push('','## Rota grupları','','| Grup | Taglar | Doğrulanmış s | Tahmini s | Kaçırılan ziyaret |','|---|---|---:|---:|---:|');
  for(const group of m.groups) out.push(`| ${group.id} | ${group.tags.join(', ')} | ${round(group.strict.correctConfirmedMs/1000)} | ${round(group.strict.correctInferredMs/1000)} | ${group.missedVisits} |`);
  out.push('','## Süreler','',m.successPercent===null?'Tag eşleşmesi doğrulanmadığı için süreler puanlanmadı.':`Koridorda yanlış oda: ${round(m.summary.corridorFalseRoomMs/1000)} s; yanlış oda: ${round(m.summary.wrongRoomMs/1000)} s; belirsiz/kayıp: ${round(m.summary.lostOrUncertainMs/1000)} s.`,
    '',`Ölçümler/veri boşlukları, bütün kararlar ve kaçırılan ziyaret çizelgeleri report.json içindedir. ${run.dataset.caveat}`,
    '','## Ham konum / sistem hatırlatması','');
  if(run.rawSpatialEvidence?.length) {
    out.push('Gerçek oda ziyareti sırasındaki ham paketler, ölçüm zamanı ve bu raporda kullanılan harita ile sınıflandırıldı.','',
      '| Tag | Ziyaret | Paket | Beklenen odada | Başka odada | Koridorda | Harita dışında | Koordinat eksik |',
      '|---|---|---:|---:|---|---:|---:|---:|');
    for(const item of run.rawSpatialEvidence) {
      const other=Object.entries(item.otherRoomCounts).map(([room,count])=>`${room}: ${count}`).join(', ')||'—';
      out.push(`| ${item.tagCode} | ${item.visitIndex}. ${item.roomId} | ${item.packetCount} | ${item.expectedRoomCount} | ${other} | ${item.corridorCount} | ${item.outsideMappedCount} | ${item.missingCoordinatesCount} |`);
    }
    out.push('');
  } else out.push('Bu raporda ziyaret bazlı ham koordinat dağılımı bulunmuyor; yeni replay ile üretilebilir.','');
  out.push('Hatırlatma: Gerçekte odadayken ham koordinatların başka odaya, koridora veya harita dışına düşmesi konum üretimi, harita hizası ya da kayıt kapsamı açısından ayrıca incelenmelidir. Böyle bir durumda motor sonucunu yalnız karar kuralına bağlamayın; doğrulanmış ve tahmini doğru oda sürelerini ayrı değerlendirin. Bu dağılım tek başına hangi sistem bileşeninin hatalı olduğunu kanıtlamaz.');
  return out.join('\n')+'\n';
}
export async function writeReport(run:Run,runId?:string):Promise<string> {
  const id=runId??`${run.testId}-${new Date().toISOString().replaceAll(':','-')}`;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Geçersiz run id');
  const dir=path.join(root,'reports',id);await mkdir(path.join(root,'reports'),{recursive:true});await mkdir(dir,{recursive:false});
  const md=markdown(run);
  await writeFile(path.join(dir,'report.json'),JSON.stringify(run,null,2)+'\n',{flag:'wx'});
  await writeFile(path.join(dir,'report.md'),md,{flag:'wx'});
  await writeFile(path.join(dir,'report.html'),`<!doctype html><html lang="tr"><meta charset="utf-8"><title>Oda benchmarkı</title><style>body{font:16px system-ui;max-width:1100px;margin:40px auto;padding:0 20px;line-height:1.5}table{border-collapse:collapse;display:block;overflow:auto}td{padding:6px 10px;border:1px solid #bbb}tr:first-child{font-weight:700;background:#eee}</style><p>Ayrıntılı kararlar: <a href="report.json">report.json</a></p>${htmlBody(md)}</html>`);
  return dir;
}
export async function readRun(file:string):Promise<Run> {return JSON.parse(await readFile(file,'utf8')) as Run;}
export function compare(a:Run,b:Run):string {
  const keys:[string,unknown,unknown][]=[['test',a.testId,b.testId],['veri',a.dataset.sha256,b.dataset.sha256],['truth revizyonu',a.dataset.truthRevision,b.dataset.truthRevision],['truth SHA',a.dataset.truthSha256,b.dataset.truthSha256],['config SHA',a.config.sha256,b.config.sha256],['tick',a.simulation.tickMs,b.simulation.tickMs],['örnekleme',a.simulation.sampleMs,b.simulation.sampleMs],['tolerans',a.simulation.boundaryToleranceMs,b.simulation.boundaryToleranceMs]];
  const differences=keys.filter(([,x,y])=>x!==y).map(([key,x,y])=>`${key}: ${x} → ${y}`);
  for(const key of ['enabled','limit','sourceSha256','settingsSha256'] as const){
    const x=a.preprocessing?.pdop[key],y=b.preprocessing?.pdop[key];
    if(x!==y)differences.push(`PDOP ${key}: ${x??'eski raporda yok'} → ${y??'eski raporda yok'}`);
  }
  if(differences.length) throw new Error(`Farklı deneyler karşılaştırılamaz:\n${differences.join('\n')}`);
  const out=[`# ${a.testId}: ${a.engineVersion} → ${b.engineVersion}`,'',`Commit: ${a.git.commit} → ${b.git.commit}`,'','| Oda | Eski doğru s | Yeni doğru s | Fark s | Eski yanlış s | Yeni yanlış s |','|---|---:|---:|---:|---:|---:|'];
  for(const id of ['room-03','room-05','room-06']) {
    const sum=(r:Run,key:'correctConfirmedMs'|'correctInferredMs'|'wrongRoomMs')=>Object.values(r.metrics.tags).reduce((n,v)=>n+(v.rooms[id]?.[key]??0),0)/1000;
    const old=sum(a,'correctConfirmedMs')+sum(a,'correctInferredMs'),now=sum(b,'correctConfirmedMs')+sum(b,'correctInferredMs');
    out.push(`| ${id} | ${round(old)} | ${round(now)} | ${round(now-old)} | ${round(sum(a,'wrongRoomMs'))} | ${round(sum(b,'wrongRoomMs'))} |`);
  }
  out.push('','Hatırlatma: Motor kazanım/kaybını yorumlarken ilgili raporlardaki ham konum dağılımını, veri boşluklarını ve doğrulanmış/tahmini doğru oda sürelerini birlikte inceleyin. Oda ziyareti sırasında başka oda veya koridor koordinatı üretilmesi, karar motoru dışındaki konumlandırma zincirinde de sorun olabileceğini gösterir.');
  return out.join('\n')+'\n';
}
