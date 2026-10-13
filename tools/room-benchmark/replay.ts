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

export interface Decision { at:string; tagCode:string; state:string; roomId:string|null; eventType:string|null; reasonCodes:string[]; evidence?:DecisionTrace['evidence'];
  synthetic:boolean; input:{measuredAt:string; receivedAt?:string; x:number; y:number; quality?:number; signalGapMs?:number}; decisionId?:string }
export interface Run { schemaVersion:1; testId:string; engineVersion:string; git:{commit:string;dirty:boolean;status:string};
  config:{path:string;sha256:string;version:string;context:string}; dataset:{source:string;caveat:string;sha256:string;rowCount:number;candidateTags:Record<string,number>;timing:string;quality:Manifest['quality'];truthRevision:number;truthSha256:string;warmupMs:number;observationMs:number};
  simulation:{tickMs:number;sampleMs:number;boundaryToleranceMs:number;tickOrigin:string;equalTimeOrder:string};
  unscoredTags:string[]; decisions:Decision[]; metrics:ReturnType<typeof score>;
  rawSpatialEvidence?:SpatialVisitEvidence[] }
const git = (args:string[]):string => { try { return execFileSync('git',args,{encoding:'utf8'}).trim(); } catch { return 'unavailable'; } };
export function replayRows(rows: RawRow[], truth: Truth, config: ReturnType<typeof compileRegionsConfig>, settings:{tickMs:number;sampleMs:number;boundaryToleranceMs:number;warmupMs:number;observationMs:number}):{decisions:Decision[];metrics:ReturnType<typeof score>;unscoredTags:string[]} {
  const decisions:Decision[]=[];
  let clock=ms(truth.test.from)-settings.warmupMs;
  const end=ms(truth.test.to)+settings.observationMs, start=clock;
  const engine=new RegionPositionEngine((p:ProcessedPosition)=>{
    const trace=p.decisionTrace;
    decisions.push({at:p.publishedAt!,tagCode:p.tagCode,state:p.regionInference.state,roomId:p.regionInference.regionId,
      eventType:trace?.eventType??null,reasonCodes:trace?.reasons.map(r=>r.code)??[],synthetic:!!p.synthetic,
      input:trace?.input??{measuredAt:p.timestamp,x:p.rawPosition?.x??p.x,y:p.rawPosition?.y??p.y},decisionId:p.decisionId,
      ...(trace?.evidence?{evidence:trace.evidence}:{})});
  },settings.tickMs,()=>clock,false);
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
      if (row.x===null || row.y===null || !Number.isFinite(row.x) || !Number.isFinite(row.y) || !row.created_at) continue;
      clock=delivered;
      engine.ingest({tagCode:row.tag_code,x:row.x,y:row.y,timestamp:row.created_at,
        ...(row.received_at?{receivedAt:row.received_at}:{}),...(row.quality===null?{}:{quality:row.quality}),
        mapId:row.map_id,sourceZoneId:row.zone_id,sourceZoneName:row.zone_name});
    }
    while (tick<=end) { clock=tick;engine.tick();tick+=settings.tickMs; }
  } finally { engine.disable(); }
  return {decisions,unscoredTags,metrics:score(truth,decisions,rows,settings.sampleMs,settings.boundaryToleranceMs)};
}
export async function runTest(id:string, options:{configPath:string;tickMs:number;sampleMs:number;boundaryToleranceMs:number}):Promise<Run> {
  const {truth,manifest,rows,truthSha256}=await readDataset(id);
  const configBytes=await readFile(options.configPath), config=compileRegionsConfig(JSON.parse(configBytes.toString()) as RegionsConfig);
  const result=replayRows(rows,truth,config,{...options,warmupMs:manifest.warmupMs,observationMs:manifest.observationMs});
  const unmatched=Object.keys(manifest.candidateTags).filter(tag=>!truth.groups.some(group=>group.tagCodes.includes(tag)));
  result.unscoredTags=[...new Set([...result.unscoredTags,...unmatched])].sort();
  const status=git(['status','--short']);
  return {schemaVersion:1,testId:id,engineVersion:ROOM_ENGINE_VERSION,git:{commit:git(['rev-parse','HEAD']),dirty:!!status,status},
    config:{path:path.resolve(options.configPath),sha256:await sha256(configBytes),version:config.version??'unversioned',
      context:manifest.source.includes('SENTETİK')?'anonim sentetik fixture + güncel harita':'geçmiş veri + güncel harita (geçmiş harita snapshotı sağlanmadı)'},
    dataset:{source:manifest.source,caveat:manifest.caveat,sha256:manifest.sha256,rowCount:manifest.rowCount,candidateTags:manifest.candidateTags,timing:manifest.timing,quality:manifest.quality,truthRevision:truth.revision,truthSha256,warmupMs:manifest.warmupMs,observationMs:manifest.observationMs},
    simulation:{tickMs:options.tickMs,sampleMs:options.sampleMs,boundaryToleranceMs:options.boundaryToleranceMs,tickOrigin:iso(new Date(ms(truth.test.from)-manifest.warmupMs).toISOString()),equalTimeOrder:'tick then packet by database id'},
    ...result,rawSpatialEvidence:spatialEvidence(rows,truth,config)};
}
