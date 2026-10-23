/** Experimental sidecar only. The production engine is imported, never copied or changed. */
import {createHash} from 'node:crypto';
import {RegionPositionEngine} from '../../../src/server/regionEngine/RegionPositionEngine';
import {pointInPolygon} from '../../../src/server/regionEngine/geometry';
import type {CompiledRegionsConfig} from '../../../src/server/regionEngine/types';
import {compareRows,deliveryMs,ms,type RawRow,type Truth} from '../model';
import {replayRows,type Decision} from '../replay';
import {score} from '../score';

export interface FilterSettings {
  distanceMeters:number; clusterRadiusMeters:number; confirmationCount:number;
  confirmationDurationMs:number; maximumGapMs:number; candidateWindowMs:number;
}
export const exampleSettings:FilterSettings={distanceMeters:3,clusterRadiusMeters:1,confirmationCount:3,
  confirmationDurationMs:1500,maximumGapMs:2000,candidateWindowMs:6000};
export interface Point {x:number;y:number;at:number;id:string}
interface State {reference:Point|null;lastObservedAt:number|null;candidate:{first:Point;last:Point;count:number}|null}
export interface PhysicalPolicy {speed:number;tolerance:number;relocationAfterMs:number;freshnessMs:number;minimumQuality:number}
export interface FilterResult {
  action:'ACCEPT'|'IGNORE'|'REJECT'|'REFERENCE_RESET';reasons:string[];
  reference:Point|null;newReference?:Point;distance?:number;count?:number;spanMs?:number;
  candidateStatus?:'STARTED'|'RESTARTED'|'COLLECTING'|'CONFIRMED';usedAsRoomEvidence:boolean;
}
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
export class DistanceRelocationFilter {
  private readonly states=new Map<string,State>();
  constructor(readonly settings:FilterSettings){
    if(Object.values(settings).some(v=>!Number.isFinite(v))||settings.distanceMeters<0||settings.distanceMeters>100)throw new Error('Invalid distance filter settings');
    if(settings.distanceMeters>0&&(settings.clusterRadiusMeters<=0||settings.clusterRadiusMeters>settings.distanceMeters||
      !Number.isInteger(settings.confirmationCount)||settings.confirmationCount<2||settings.confirmationDurationMs<=0||
      settings.maximumGapMs<=0||settings.candidateWindowMs<settings.confirmationDurationMs))throw new Error('Invalid candidate settings');
  }
  clear(key:string){this.states.delete(key);}
  inspect(key:string){return structuredClone(this.states.get(key));}
  process(key:string,row:RawRow,now:number,policy:PhysicalPolicy):FilterResult{
    const s=this.states.get(key)??{reference:null,lastObservedAt:null,candidate:null};this.states.set(key,s);
    const result=(action:FilterResult['action'],reasons:string[],extra:Partial<FilterResult>={}):FilterResult=>
      ({action,reasons,reference:s.reference?{...s.reference}:null,usedAsRoomEvidence:action==='ACCEPT',...extra});
    if(this.settings.distanceMeters===0)return result('ACCEPT',[]);
    const at=row.created_at?Date.parse(row.created_at):NaN;
    if(!Number.isFinite(at)||row.x===null||row.y===null||!Number.isFinite(row.x)||!Number.isFinite(row.y)||at>now+2000){
      s.candidate=null;return result('REJECT',['INVALID_INPUT']);
    }
    if(s.lastObservedAt!==null&&at<=s.lastObservedAt)return result('IGNORE',['DUPLICATE_OR_OUT_OF_ORDER']);
    s.lastObservedAt=at;
    const invalid:string[]=[];
    if(now-at>policy.freshnessMs)invalid.push('MEASUREMENT_REJECTED_BY_FRESHNESS');
    if(!Number.isFinite(row.quality??1)||(row.quality??1)<policy.minimumQuality)invalid.push('MEASUREMENT_REJECTED_BY_QUALITY');
    if(invalid.length){s.candidate=null;return result('REJECT',invalid);}
    const p:Point={x:row.x,y:row.y,at,id:row.id};
    if(!s.reference){s.reference=p;s.candidate=null;return result('ACCEPT',[]);}
    const previous={...s.reference},d=distance(previous,p),delta=at-previous.at;
    const speedOK=delta>=policy.relocationAfterMs||d<=policy.speed*delta/1000+policy.tolerance;
    if(d<=this.settings.distanceMeters&&speedOK){s.reference=p;s.candidate=null;return result('ACCEPT',[],{reference:previous,distance:d});}
    if(d<=this.settings.distanceMeters){s.candidate=null;return result('REJECT',['MEASUREMENT_REJECTED_BY_SPEED'],{distance:d});}
    const reasons=['MEASUREMENT_REJECTED_BY_DISTANCE',...(!speedOK?['MEASUREMENT_REJECTED_BY_SPEED']:[])];
    const c=s.candidate;
    const start=(status:'STARTED'|'RESTARTED')=>{
      s.candidate={first:p,last:p,count:1};return result('REJECT',reasons,{distance:d,count:1,spanMs:0,candidateStatus:status});
    };
    if(!c)return start('STARTED');
    const gap=at-c.last.at,span=at-c.first.at,step=distance(c.last,p);
    if(gap>this.settings.maximumGapMs||span>this.settings.candidateWindowMs||step>this.settings.distanceMeters||
      distance(c.first,p)>this.settings.clusterRadiusMeters||step>policy.speed*gap/1000+policy.tolerance)return start('RESTARTED');
    c.last=p;c.count=Math.min(c.count+1,this.settings.confirmationCount);
    if(c.count<this.settings.confirmationCount||span<this.settings.confirmationDurationMs)
      return result('REJECT',reasons,{distance:d,count:c.count,spanMs:span,candidateStatus:'COLLECTING'});
    const count=c.count;s.reference=p;s.candidate=null;
    return result('REFERENCE_RESET',[...reasons,'DISTANCE_REFERENCE_REESTABLISHED'],
      {reference:previous,newReference:p,distance:d,count,spanMs:span,candidateStatus:'CONFIRMED',usedAsRoomEvidence:false});
  }
}

export type SimulationSettings={tickMs:number;sampleMs:number;boundaryToleranceMs:number;warmupMs:number;observationMs:number};
export type FilterEvent=FilterResult&{tagCode:string;mapId:string|null;rowId:string;measuredAt:string|null;deliveredAt:string;x:number|null;y:number|null};
export function replayWithDistanceFilter(rows:RawRow[],truth:Truth,config:CompiledRegionsConfig,simulation:SimulationSettings,settings:FilterSettings){
  if(settings.distanceMeters===0)return {...replayRows(rows,truth,config,simulation),filterEvents:[] as FilterEvent[]};
  const filter=new DistanceRelocationFilter(settings),decisions:Decision[]=[],filterEvents:FilterEvent[]=[];
  let now=ms(truth.test.from)-simulation.warmupMs,tick=now+simulation.tickMs;
  const start=now,end=ms(truth.test.to)+simulation.observationMs;
  const engine=new RegionPositionEngine(p=>decisions.push({at:p.publishedAt!,tagCode:p.tagCode,state:p.regionInference.state,roomId:p.regionInference.regionId,
    eventType:p.decisionTrace?.eventType??null,reasonCodes:p.decisionTrace?.reasons.map(r=>r.code)??[],synthetic:!!p.synthetic,
    input:p.decisionTrace!.input,decisionId:p.decisionId}),simulation.tickMs,()=>now,false);
  engine.enable(config);
  const maps=new Map<string,string|null>();
  const raw=(r:RawRow)=>({tagCode:r.tag_code,x:r.x!,y:r.y!,timestamp:r.created_at!,
    ...(r.received_at?{receivedAt:r.received_at}:{}),...(r.quality===null?{}:{quality:r.quality}),mapId:r.map_id,sourceZoneId:r.zone_id,sourceZoneName:r.zone_name});
  try{
    for(const row of [...rows].sort(compareRows)){
      const delivered=deliveryMs(row);if(delivered<start||delivered>end)continue;
      while(tick<=delivered){now=tick;engine.tick();tick+=simulation.tickMs;}now=delivered;
      if(maps.has(row.tag_code)&&maps.get(row.tag_code)!==row.map_id){engine.removeVehicle(row.tag_code);filter.clear(row.tag_code);}
      maps.set(row.tag_code,row.map_id);
      const state=engine.getVehicleState(row.tag_code),active=config.regions.find(r=>r.id===state?.activeRegionId);
      const containing=row.x===null||row.y===null?[]:config.regions.filter(r=>pointInPolygon({x:row.x!,y:row.y!},r));
      const target=containing.length===1?containing[0]:undefined,physical=(target??active)?.settings??config.rules;
      const result=filter.process(row.tag_code,row,now,{speed:physical.maximumSpeedMetersPerSecond,tolerance:physical.movementToleranceMeters,
        relocationAfterMs:active?.settings.relocationAfterMs??config.rules.relocationAfterMs,
        freshnessMs:Math.max(physical.maxEvidenceGapMs,(physical.expectedIntervalMs||state?.cadence||0)*3),minimumQuality:physical.minimumHardwareQuality});
      filterEvents.push({...result,tagCode:row.tag_code,mapId:row.map_id,rowId:row.id,measuredAt:row.created_at,deliveredAt:new Date(now).toISOString(),x:row.x,y:row.y});
      if(result.action==='IGNORE'||result.reasons.includes('INVALID_INPUT'))continue;
      if(result.action==='ACCEPT'){
        engine.ingest(raw(row));
        // A mismatch would invalidate the experiment: both references must agree after a normal acceptance.
        if(engine.getVehicleState(row.tag_code)?.lastRawDataTimestamp!==Date.parse(row.created_at!))throw new Error('Filter/engine physical acceptance mismatch');
        continue;
      }
      if(result.action==='REJECT'&&!result.reasons.includes('MEASUREMENT_REJECTED_BY_DISTANCE')&&state&&Number.isFinite(row.quality??1)){
        engine.ingest(raw(row));continue; // Existing freshness/quality/speed rejection behavior.
      }
      if(result.action==='REFERENCE_RESET')engine.removeVehicle(row.tag_code);
      else if(state){
        // Narrow experiment-only adapter for the new rejection path. No evidence, raw reference,
        // cadence, support time or door candidate is changed. Expired evidence cannot be revived.
        const s=active?.settings??config.rules;
        const multiplier=s.coverage==='silent'?s.silentCoverageStaleMultiplier:s.coverage==='intermittent'?s.intermittentCoverageStaleMultiplier:s.regularCoverageStaleMultiplier;
        const lostAfter=Math.max(s.lostAfterMs,Math.max(state.cadence,s.expectedIntervalMs)*multiplier*s.lostAfterStaleMultiplier);
        state.state=state.activeRegionId&&now-state.lastRawDataTimestamp<lostAfter?'INFERRED_IN_REGION':'LOCATION_LOST';
        state.entryConfidence=Math.min(state.entryConfidence,physical.invalidMeasurementMaximumScore);
        state.lastSeenRawPosition=raw(row);state.lastSeenRawDataTimestamp=Date.parse(row.created_at!);
        state.lastPublishedTimestamp=now;
      }
      const current=engine.getVehicleState(row.tag_code),eventType=result.action==='REFERENCE_RESET'?'FILTER_REFERENCE_RESET':'MEASUREMENT_REJECTED';
      decisions.push({at:new Date(now).toISOString(),tagCode:row.tag_code,state:current?.state??'LOCATION_LOST',
        roomId:current?.state==='LOCATION_LOST'?null:current?.activeRegionId??null,eventType,reasonCodes:result.reasons,synthetic:false,
        input:{measuredAt:row.created_at!,...(row.received_at?{receivedAt:row.received_at}:{}),x:row.x!,y:row.y!,...(row.quality===null?{}:{quality:row.quality})},
        decisionId:createHash('sha256').update(JSON.stringify(['distance-experiment-v1',settings,row.id,now,result.action])).digest('hex')});
    }
    while(tick<=end){now=tick;engine.tick();tick+=simulation.tickMs;}
  }finally{engine.disable();}
  const scored=new Set(truth.groups.flatMap(g=>g.tagCodes));
  return {decisions,filterEvents,metrics:score(truth,decisions,rows,simulation.sampleMs,simulation.boundaryToleranceMs),
    unscoredTags:[...new Set(rows.map(r=>r.tag_code))].filter(tag=>!scored.has(tag)).sort()};
}
