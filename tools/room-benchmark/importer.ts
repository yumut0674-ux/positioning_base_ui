import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { queryPostgres } from '../../src/server/postgresClient';
import { catalog } from './catalog';
import { compareRows, deliveryMs, iso, ms, sha256, type Manifest, type RawRow, type Truth } from './model';

const q = (s: string): string => `'${s.replaceAll("'", "''")}'`;
const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ''));
export const datasetDir = (id: string): string => {
  if (!/^test-[0-9a-f-]{36}$/.test(id)) throw new Error('Geçersiz test ID');
  return path.join(root, 'datasets', id);
};
const mapped = (r: Record<string,string|null>): RawRow => ({
  id: r.id!, tag_code: r.tag_code!, x: r.x === null ? null : Number(r.x), y: r.y === null ? null : Number(r.y),
  created_at: r.created_at ? iso(r.created_at) : null, received_at: r.received_at ? iso(r.received_at) : null,
  quality: r.quality === null ? null : Number(r.quality), map_id: r.map_id,
  zone_id: r.zone_id, zone_name: r.zone_name,
});
export async function readTruth(id: string): Promise<Truth> {
  const truth = JSON.parse(await readFile(path.join(datasetDir(id),'truth.json'),'utf8')) as Truth;
  if (truth.testId !== id || truth.timezone !== 'Europe/Istanbul' || !Number.isInteger(truth.revision) || !truth.revisionReason) throw new Error('Truth kimlik/revizyon hatası');
  const from=ms(truth.test.from), to=ms(truth.test.to);
  if (from >= to) throw new Error('Test aralığı geçersiz');
  for (const v of truth.visits) if (ms(v.from)<from || ms(v.to)>to || ms(v.from)>=ms(v.to)) throw new Error('Oda aralığı geçersiz');
  const seen=new Set<string>();
  for (const g of truth.groups) for (const tag of g.tagCodes) { if (seen.has(tag)) throw new Error(`Tag birden fazla grupta: ${tag}`); seen.add(tag); }
  return truth;
}
export async function ensureCatalog(): Promise<void> {
  for (const truth of catalog) {
    const dir=datasetDir(truth.testId); await mkdir(dir,{recursive:true});
    const file=path.join(dir,'truth.json');
    try { await readFile(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await writeFile(file,JSON.stringify(truth,null,2)+'\n',{flag:'wx'}); }
  }
}
export async function listCandidates(id: string, warmupMs=30_000, observationMs=60_000): Promise<Record<string,number>> {
  const truth=await readTruth(id), from=iso(new Date(ms(truth.test.from)-warmupMs).toISOString()), to=iso(new Date(ms(truth.test.to)+observationMs).toISOString());
  const rows=await queryPostgres(`SELECT tag_code, count(*)::text AS count FROM tag_location_history WHERE created_at >= ${q(from)}::timestamptz AND created_at <= ${q(to)}::timestamptz GROUP BY tag_code ORDER BY count(*) DESC, tag_code`);
  return Object.fromEntries(rows.map(r=>[r.tag_code!,Number(r.count)]));
}
export function inspectRows(rows: RawRow[], gapThresholdMs=5000): Manifest['quality'] {
  const quality: Manifest['quality']={missingReceivedAt:0,missingMeasurementAt:0,missingCoordinates:0,missingQuality:0,timingAnomalies:0,anomalyRows:[],largeGaps:[]};
  const last=new Map<string,RawRow>();
  for (const row of rows) {
    if (!row.received_at) quality.missingReceivedAt++;
    if (!row.created_at) quality.missingMeasurementAt++;
    if (row.x===null || row.y===null || !Number.isFinite(row.x) || !Number.isFinite(row.y)) quality.missingCoordinates++;
    if (row.quality===null) quality.missingQuality++;
    if (row.created_at && row.received_at && ms(row.created_at)>ms(row.received_at)) {
      quality.timingAnomalies++;
      quality.anomalyRows.push({id:row.id,tagCode:row.tag_code,createdAt:row.created_at,receivedAt:row.received_at,deltaMs:ms(row.created_at)-ms(row.received_at)});
    }
    const prev=last.get(row.tag_code);
    if (prev) { const gap=deliveryMs(row)-deliveryMs(prev); if (gap>gapThresholdMs) quality.largeGaps.push({tagCode:row.tag_code,from:iso(new Date(deliveryMs(prev)).toISOString()),to:iso(new Date(deliveryMs(row)).toISOString()),ms:gap}); }
    last.set(row.tag_code,row);
  }
  return quality;
}
export async function importTest(id: string, tags: string[], warmupMs=30_000, observationMs=60_000): Promise<Manifest> {
  if (warmupMs<0 || observationMs<0) throw new Error('Negatif pencere');
  const truth=await readTruth(id), dir=datasetDir(id);
  for (const name of ['raw.jsonl','manifest.json']) {
    try { await readFile(path.join(dir,name)); throw new Error(`${name} zaten mevcut; değişmez veri üzerine yazılmaz`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const candidates=await listCandidates(id,warmupMs,observationMs);
  if (!tags.length) throw new Error('Tag seçimi gerekli. Önce candidates komutunu çalıştırın; eşleşmeyi truth.json içine elle kaydedin.');
  for (const tag of tags) if (!(tag in candidates)) throw new Error(`Tag aralıkta yok: ${tag}`);
  const from=new Date(ms(truth.test.from)-warmupMs).toISOString(), to=new Date(ms(truth.test.to)+observationMs).toISOString();
  // The local client executes exactly this one SELECT. No schema helper is imported.
  const rows=(await queryPostgres(`SELECT id::text, tag_code, x::text, y::text, created_at::text, received_at::text, quality::text, map_id, zone_id, zone_name FROM tag_location_history WHERE created_at >= ${q(from)}::timestamptz AND created_at <= ${q(to)}::timestamptz AND tag_code IN (${tags.map(q).join(',')}) ORDER BY created_at, id`)).map(mapped).sort(compareRows);
  if (!rows.length) throw new Error('Seçili tag için satır yok');
  const raw=Buffer.from(rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const sha=await sha256(raw), quality=inspectRows(rows);
  const mapIds: Record<string,number>={}; for (const r of rows) mapIds[r.map_id??'(eksik)']=(mapIds[r.map_id??'(eksik)']??0)+1;
  const manifest:Manifest={testId:id,source:'tag_location_history SELECT; DB kayıtları canlı motorun gördüğü tüm ham olayları kapsamayabilir',timezone:'Europe/Istanbul',importedAt:new Date().toISOString(),warmupMs,observationMs,selectedTags:tags,candidateTags:candidates,rowCount:rows.length,sha256:sha,timing:quality.missingReceivedAt?'approximate':'exact',mapIds,quality,caveat:'Kayıtlı tag/DB satırları canlı akışın eksiksiz kopyası değildir; geçmiş harita snapshotı yoksa güncel harita kullanılır.'};
  await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,'raw.jsonl'),raw,{flag:'wx'});
  await writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return manifest;
}
export async function readDataset(id:string):Promise<{truth:Truth;manifest:Manifest;rows:RawRow[];truthSha256:string}> {
  const dir=datasetDir(id), truthBytes=await readFile(path.join(dir,'truth.json')), truth=await readTruth(id);
  const manifest=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8')) as Manifest;
  const raw=await readFile(path.join(dir,'raw.jsonl'));
  if (await sha256(raw)!==manifest.sha256) throw new Error('raw.jsonl SHA-256 uyuşmuyor; değişmez veri bozulmuş');
  const rows=raw.toString().trimEnd().split('\n').filter(Boolean).map(line=>JSON.parse(line) as RawRow);
  if (rows.length!==manifest.rowCount) throw new Error('Satır sayısı uyuşmuyor');
  return {truth,manifest,rows,truthSha256:await sha256(truthBytes)};
}
