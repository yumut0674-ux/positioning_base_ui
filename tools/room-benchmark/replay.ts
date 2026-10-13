import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { RegionPositionEngine, ROOM_ENGINE_VERSION } from '../../src/server/regionEngine/RegionPositionEngine';
import { compileRegionsConfig } from '../../src/server/regionEngine/configLoader';
import type { ProcessedPosition, DecisionTrace } from '../../src/server/regionEngine/types';
import type { RegionsConfig } from '../../src/features/regions/types/region.types';
import { compareRows, deliveryMs, iso, ms, sha256, type Manifest, type RawRow, type Truth } from './model';
import { readDataset } from './importer';
import { score } from './score';
import { spatialEvidence, type SpatialVisitEvidence } from './spatialEvidence';
import {isPositionPdopAccepted,MAX_POSITION_PDOP,DEFAULT_PDOP_FILTER_SETTINGS,parsePdopFilterSettings,type PdopFilterSettings} from '../../src/shared/tracking/pdop';

export interface Decision { at:string; tagCode:string; state:string; roomId:string|null; eventType:string|null; reasonCodes:string[]; evidence?:DecisionTrace['evidence'];
  synthetic:boolean; input:{measuredAt:string; receivedAt?:string; x:number; y:number; quality?:number; pdop?:number|null; signalGapMs?:number}; decisionId?:string }
export interface ReplayPreprocessing {pdop:{enabled:boolean;limit:number;knownValues:number;unknownValues:number;
  rejected:{id:string;tagCode:string;measuredAt:string|null;deliveredAt:string;pdop:number|null;x:number|null;y:number|null;reasonCode:string}[];
  sourcePath?:string;sourceSha256?:string;settingsPath?:string;settingsSha256?:string;settingsSource?:string;caveat?:string}}
export interface Run { schemaVersion:1; testId:string; engineVersion:string; git:{commit:string;dirty:boolean;status:string};
  config:{path:string;sha256:string;version:string;context:string}; dataset:{source:string;caveat:string;sha256:string;rowCount:number;candidateTags:Record<string,number>;timing:string;quality:Manifest['quality'];pdop?:Manifest['pdop'];truthRevision:number;truthSha256:string;warmupMs:number;observationMs:number};
  simulation:{tickMs:number;sampleMs:number;boundaryToleranceMs:number;tickOrigin:string;equalTimeOrder:string};
  unscoredTags:string[]; decisions:Decision[]; metrics:ReturnType<typeof score>;
  rawSpatialEvidence?:SpatialVisitEvidence[];preprocessing?:ReplayPreprocessing }
export type ReplayResult={decisions:Decision[];metrics:ReturnType<typeof score>;unscoredTags:string[];preprocessing:ReplayPreprocessing};
/** Historical comparisons use a verified Git snapshot with this same delivery/clock harness. */
export type ReplayEngineFactory=(publish:(position:ProcessedPosition)=>void,intervalMs:number,now:()=>number)=>Pick<RegionPositionEngine,'enable'|'ingest'|'tick'|'disable'>;
const git = (args:string[]):string => { try { return execFileSync('git',args,{encoding:'utf8'}).trim(); } catch { return 'unavailable'; } };
/** Read only the map's input filter file. Never load the live settings service or its writer. */
export async function readReplayPdopSettings(configPath:string):Promise<{settings:PdopFilterSettings;path:string;sha256:string|null;source:string}> {
  const settingsPath=path.join(path.dirname(path.resolve(configPath)),'tracking-filter.json');
  try {
    const bytes=await readFile(settingsPath);
    return {settings:parsePdopFilterSettings(JSON.parse(bytes.toString())),path:settingsPath,sha256:await sha256(bytes),source:'map-file'};
  } catch(error) {
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    return {settings:DEFAULT_PDOP_FILTER_SETTINGS,path:settingsPath,sha256:null,source:'shared-default (map file absent)'};
  }
}
export function replayRows(rows: RawRow[], truth: Truth, config: ReturnType<typeof compileRegionsConfig>, settings:{tickMs:number;sampleMs:number;boundaryToleranceMs:number;warmupMs:number;observationMs:number;pdopEnabled?:boolean;pdopMax?:number},engineFactory:ReplayEngineFactory=(publish,interval,now)=>new RegionPositionEngine(publish,interval,now,false)):ReplayResult {
  const decisions:Decision[]=[];
  let deliveringRow:RawRow|undefined;
  const limit=settings.pdopMax??MAX_POSITION_PDOP;
  if(!Number.isFinite(limit)||limit<0)throw new Error('Geçersiz PDOP eşiği');
  const preprocessing:ReplayPreprocessing={pdop:{enabled:settings.pdopEnabled??true,limit,knownValues:0,unknownValues:0,rejected:[]}};
  let clock=ms(truth.test.from)-settings.warmupMs;
  const end=ms(truth.test.to)+settings.observationMs, start=clock;
  const engine=engineFactory((p:ProcessedPosition)=>{
    const trace=p.decisionTrace;
    decisions.push({at:p.publishedAt!,tagCode:p.tagCode,state:p.regionInference.state,roomId:p.regionInference.regionId,
      eventType:trace?.eventType??null,reasonCodes:trace?.reasons.map(r=>r.code)??[],synthetic:!!p.synthetic,
      input:{...(trace?.input??{measuredAt:p.timestamp,x:p.rawPosition?.x??p.x,y:p.rawPosition?.y??p.y}),pdop:!p.synthetic&&deliveringRow?deliveringRow.pdop??null:p.rawPosition?.pdop??p.pdop??null},decisionId:p.decisionId,
      ...(trace?.evidence?{evidence:trace.evidence}:{})});
  },settings.tickMs,()=>clock);
  engine.enable(config);
  const sorted=[...rows].sort(compareRows), groups=truth.groups;
  const scored=new Set(groups.flatMap(g=>g.tagCodes));
  const unscoredTags=[...new Set(rows.map(r=>r.tag_code))].filter(tag=>!scored.has(tag)).sort();
  let tick=start+settings.tickMs;
  try {
    for (const row of sorted) {
      const delivered=deliveryMs(row);
      if (delivered>end) continue;
      if (delivered<start) continue;
      while (tick<=delivered) { clock=tick;engine.tick();tick+=settings.tickMs; }
      clock=delivered;
      if(row.pdop==null)preprocessing.pdop.unknownValues++;else preprocessing.pdop.knownValues++;
      const pdopAccepted=isPositionPdopAccepted(row.pdop,{enabled:preprocessing.pdop.enabled,maximumPdop:limit});
      if(!pdopAccepted){
        preprocessing.pdop.rejected.push({id:row.id,tagCode:row.tag_code,measuredAt:row.created_at,deliveredAt:iso(new Date(delivered).toISOString()),pdop:row.pdop??null,x:row.x,y:row.y,reasonCode:'PDOP_REJECTED_BEFORE_ENGINE'});
        continue;
      }
      if (row.x===null || row.y===null || !Number.isFinite(row.x) || !Number.isFinite(row.y) || !row.created_at) continue;
      clock=delivered;
      deliveringRow=row;
      try {
        engine.ingest({tagCode:row.tag_code,x:row.x,y:row.y,timestamp:row.created_at,
          ...(row.received_at?{receivedAt:row.received_at}:{}),...(row.quality===null?{}:{quality:row.quality}),
          ...('pdop' in row?{pdop:row.pdop}:{}),
          mapId:row.map_id,sourceZoneId:row.zone_id,sourceZoneName:row.zone_name});
      } finally { deliveringRow=undefined; }
    }
    while (tick<=end) { clock=tick;engine.tick();tick+=settings.tickMs; }
  } finally { engine.disable(); }
  return {decisions,unscoredTags,preprocessing,metrics:score(truth,decisions,rows,settings.sampleMs,settings.boundaryToleranceMs)};
}
export async function runTest(id:string, options:{configPath:string;tickMs:number;sampleMs:number;boundaryToleranceMs:number;pdopEnabled?:boolean;pdopMax?:number}):Promise<Run> {
  const {truth,manifest,rows,truthSha256}=await readDataset(id);
  const configBytes=await readFile(options.configPath), config=compileRegionsConfig(JSON.parse(configBytes.toString()) as RegionsConfig);
  const pdop=await readReplayPdopSettings(options.configPath);
  const result=replayRows(rows,truth,config,{...options,pdopEnabled:options.pdopEnabled??pdop.settings.enabled,pdopMax:options.pdopMax??pdop.settings.maximumPdop,warmupMs:manifest.warmupMs,observationMs:manifest.observationMs});
  result.preprocessing.pdop.sourcePath=path.resolve('src/shared/tracking/pdop.ts');
  result.preprocessing.pdop.sourceSha256=await sha256(await readFile(result.preprocessing.pdop.sourcePath));
  result.preprocessing.pdop.settingsPath=pdop.path;
  result.preprocessing.pdop.settingsSha256=pdop.sha256??'absent';
  result.preprocessing.pdop.settingsSource=pdop.source+(options.pdopEnabled!==undefined||options.pdopMax!==undefined?'; offline override':'');
  result.preprocessing.pdop.caveat=manifest.pdop?.caveat??'Geçmiş raw dosyasında PDOP bulunmayabilir. Elenmiş canlı paketler DB replay ile geri getirilemez.';
  const unmatched=Object.keys(manifest.candidateTags).filter(tag=>!truth.groups.some(group=>group.tagCodes.includes(tag)));
  result.unscoredTags=[...new Set([...result.unscoredTags,...unmatched])].sort();
  const status=git(['status','--short']);
  return {schemaVersion:1,testId:id,engineVersion:ROOM_ENGINE_VERSION,git:{commit:git(['rev-parse','HEAD']),dirty:!!status,status},
    config:{path:path.resolve(options.configPath),sha256:await sha256(configBytes),version:config.version??'unversioned',
      context:manifest.source.includes('SENTETİK')?'anonim sentetik fixture + güncel harita':'geçmiş veri + güncel harita (geçmiş harita snapshotı sağlanmadı)'},
    dataset:{source:manifest.source,caveat:manifest.caveat,sha256:manifest.sha256,rowCount:manifest.rowCount,candidateTags:manifest.candidateTags,timing:manifest.timing,quality:manifest.quality,...(manifest.pdop?{pdop:manifest.pdop}:{}),truthRevision:truth.revision,truthSha256,warmupMs:manifest.warmupMs,observationMs:manifest.observationMs},
    simulation:{tickMs:options.tickMs,sampleMs:options.sampleMs,boundaryToleranceMs:options.boundaryToleranceMs,tickOrigin:iso(new Date(ms(truth.test.from)-manifest.warmupMs).toISOString()),equalTimeOrder:'tick then packet by database id'},
    ...result,rawSpatialEvidence:spatialEvidence(rows,truth,config)};
}
