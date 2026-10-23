/** Offline prototype: keep entry evidence across bounded outside measurements.
 * The active engine performs every validation, score, door, entry and exit decision.
 * Only its candidate epoch is restored through getVehicleState in this isolated instance.
 * This adapter is coupled to that diagnostic state; it is not a production implementation.
 */
import {RegionPositionEngine} from '../../../src/server/regionEngine/RegionPositionEngine';
import {pointInPolygon,wallDistance} from '../../../src/server/regionEngine/geometry';
import type {CompiledRegionsConfig,ProcessedPosition} from '../../../src/server/regionEngine/types';
import type {ReplayEngineFactory} from '../replay';
import {createHash} from 'node:crypto';

export interface EntryMemoryPolicy {
  id:string; maximumOutsidePoints:number; returnWithinMs:number; windowMs:number;
  minimumInsideFraction:number;
  /** Only the sequence study enables this. Existing v1 profiles retain their behavior. */
  sequence?:{minimumInsidePoints:4|'map-minimum';trailingInsidePoints:2;outsideIndex?:2;ignoreWeakInside?:true};
}
export const ENTRY_MEMORY_POLICIES:EntryMemoryPolicy[]=[
  {id:'one-outside-1500-window6000',maximumOutsidePoints:1,returnWithinMs:1500,windowMs:6000,minimumInsideFraction:0.75},
  {id:'one-outside-3000-window6000',maximumOutsidePoints:1,returnWithinMs:3000,windowMs:6000,minimumInsideFraction:0.75},
  {id:'one-outside-3000-window12000',maximumOutsidePoints:1,returnWithinMs:3000,windowMs:12000,minimumInsideFraction:0.75},
  // Deliberately permissive sensitivity control, not a recommended setting.
  {id:'permissive-outside-window12000',maximumOutsidePoints:20,returnWithinMs:4000,windowMs:12000,minimumInsideFraction:0},
];
export const ENTRY_PATTERN_POLICIES:EntryMemoryPolicy[]=[
  {id:'user-4-of-5-return1500-window6000',maximumOutsidePoints:1,returnWithinMs:1500,windowMs:6000,minimumInsideFraction:0.8,
    sequence:{minimumInsidePoints:4,trailingInsidePoints:2}},
  {id:'user-4-of-5-return3000-window6000',maximumOutsidePoints:1,returnWithinMs:3000,windowMs:6000,minimumInsideFraction:0.8,
    sequence:{minimumInsidePoints:4,trailingInsidePoints:2}},
  {id:'user-4-of-5-return3000-window12000',maximumOutsidePoints:1,returnWithinMs:3000,windowMs:12000,minimumInsideFraction:0.8,
    sequence:{minimumInsidePoints:4,trailingInsidePoints:2}},
  {id:'map-count-preserved-return3000-window6000',maximumOutsidePoints:1,returnWithinMs:3000,windowMs:6000,minimumInsideFraction:0.8,
    sequence:{minimumInsidePoints:'map-minimum',trailingInsidePoints:2}},
  {id:'user-exact-2-1-2-return3000-window6000',maximumOutsidePoints:1,returnWithinMs:3000,windowMs:6000,minimumInsideFraction:0.8,
    sequence:{minimumInsidePoints:4,trailingInsidePoints:2,outsideIndex:2}},
  {id:'user-evidence-2-1-2-return3000-window6000',maximumOutsidePoints:1,returnWithinMs:3000,windowMs:6000,minimumInsideFraction:0.8,
    sequence:{minimumInsidePoints:4,trailingInsidePoints:2,outsideIndex:2,ignoreWeakInside:true}},
];
export const entryMemoryConfigVersion=(version:string|undefined,policy:EntryMemoryPolicy)=>policy.sequence
  ?createHash('sha256').update(JSON.stringify({base:version,experiment:'entry-pattern-v2',policy})).digest('hex').slice(0,16):version;
export interface EntryMemoryTrace {
  at:string; measuredAt:string; tag:string; roomId:string; action:string;
  strongInsidePoints:number; outsidePoints:number; reason:string;
  recentPattern?:string;
}
type Sample={kind:'inside'|'weak'|'outside';at:number};
interface Pending {
  roomId:string; since:number; firstDelivery:number; lastMeasurement:number; lastDelivery:number;
  firstOutsideMeasurement?:number; firstOutsideDelivery?:number;
  strongInsidePoints:number; outsidePoints:number;
  samples?:Sample[];
}

export function entryMemoryFactory(policy:EntryMemoryPolicy,trace:EntryMemoryTrace[]=[]):ReplayEngineFactory {
  if(policy.maximumOutsidePoints<1||!Number.isInteger(policy.maximumOutsidePoints)||policy.returnWithinMs<=0||policy.windowMs<=0
    ||policy.minimumInsideFraction<0||policy.minimumInsideFraction>1)throw Error('Invalid entry memory policy');
  return (publish,interval,now)=>{
    let config:CompiledRegionsConfig;
    let queued:ProcessedPosition[]|undefined;
    const pending=new Map<string,Pending>();
    const engine=new RegionPositionEngine(p=>queued?queued.push(p):publish(p),interval,now,false);
    const log=(raw:Parameters<RegionPositionEngine['ingest']>[0],p:Pending,action:string,reason:string)=>
      trace.push({at:new Date(now()).toISOString(),measuredAt:raw.timestamp,tag:raw.tagCode,roomId:p.roomId,action,
        strongInsidePoints:p.strongInsidePoints,outsidePoints:p.outsidePoints,reason,
        ...(p.samples?{recentPattern:p.samples.map(s=>s.kind==='inside'?'I':s.kind==='outside'?'O':'W').join('')}: {})});
    return {
      enable(c){
        config=policy.sequence?{...structuredClone(c),version:entryMemoryConfigVersion(c.version,policy)}:c;
        pending.clear();engine.enable(config);
      },
      ingest(raw){
        const measured=Date.parse(raw.timestamp),delivered=now(),prior=engine.getVehicleState(raw.tagCode);
        const rooms=config.regions.filter(r=>pointInPolygon(raw,r));
        const region=rooms.length===1?rooms[0]:undefined;
        let memory=pending.get(raw.tagCode);
        const memoryRegion=memory?config.regions.find(r=>r.id===memory!.roomId):undefined;
        const expired=memory&&(measured-memory.since>Math.min(policy.windowMs,memoryRegion!.settings.evidenceWindowMs)
          ||delivered-memory.firstDelivery>policy.windowMs
          ||measured-memory.lastMeasurement>memoryRegion!.settings.maxEvidenceGapMs
          ||delivered-memory.lastDelivery>memoryRegion!.settings.maxEvidenceGapMs
          ||(memory.firstOutsideMeasurement!==undefined&&(measured-memory.firstOutsideMeasurement>policy.returnWithinMs
            ||delivered-memory.firstOutsideDelivery!>policy.returnWithinMs)));
        if(memory&&(prior?.activeRegionId||expired)){
          log(raw,memory,'discard',prior?.activeRegionId?'active room; entry-only experiment':'bounded evidence expired');
          pending.delete(raw.tagCode);memory=undefined;
        }
        const shared=region&&config.regions.some(r=>r.id!==region.id&&wallDistance(raw,r)<region.settings.sharedWallBandMeters);
        const quality=raw.quality??1;
        const strong=!!region&&wallDistance(raw,region)>(shared?region.settings.sharedWallBandMeters:region.settings.wallBandMeters)
          &&Number.isFinite(quality)&&quality>=region.settings.minimumHardwareQuality
          &&region.settings.reliableEvidenceWeight*Math.min(1,quality)>=region.settings.reliableEvidenceWeight;
        // Reuse only at a returning strong inside point, never at the outside point or a timer.
        // The engine still checks speed, step distance, measurement age, order and quality.
        const requiredInside=region?(policy.sequence?.minimumInsidePoints==='map-minimum'
          ?Math.max(4,region.settings.entryConfirmationCount):4):4;
        const recent=policy.sequence?[...(memory?.samples??[]),{kind:strong?'inside':'weak',at:measured} as Sample].slice(-(requiredInside+1)):undefined;
        const sequenceOK=!policy.sequence||(recent!.length===requiredInside+1
          &&recent!.filter(s=>s.kind==='inside').length>=requiredInside
          &&recent!.filter(s=>s.kind==='outside').length===1
          &&(policy.sequence.outsideIndex===undefined||recent![policy.sequence.outsideIndex].kind==='outside')
          &&recent!.slice(-policy.sequence.trailingInsidePoints).every(s=>s.kind==='inside'));
        const reuse=!!prior&&!prior.activeRegionId&&!!memory&&memory.outsidePoints>0&&region?.id===memory.roomId&&strong&&sequenceOK
          &&(memory.strongInsidePoints+1)/(memory.strongInsidePoints+1+memory.outsidePoints)>=policy.minimumInsideFraction;
        const saved=prior?{candidateRegionId:prior.candidateRegionId,candidateSince:prior.candidateSince}:undefined;
        if(reuse){prior!.candidateRegionId=memory!.roomId;prior!.candidateSince=recent?recent[0].at:memory!.since;}
        // Four-of-five is an alternative path, not a global reduction of the Service threshold.
        // Only this qualifying packet uses min(original count,4). Native duration/door policies stay intact.
        const temporaryCount=reuse&&policy.sequence?.minimumInsidePoints===4&&region!.settings.entryConfirmationCount>4
          ?region!.settings.entryConfirmationCount:undefined;
        if(temporaryCount!==undefined)(region!.settings as {entryConfirmationCount:number}).entryConfirmationCount=4;
        queued=[];
        let output:ProcessedPosition|undefined;
        try{output=engine.ingest(raw);}catch(error){queued=undefined;throw error;}
        finally{if(temporaryCount!==undefined)(region!.settings as {entryConfirmationCount:number}).entryConfirmationCount=temporaryCount;}
        const state=engine.getVehicleState(raw.tagCode);
        // Identity with the engine's appended history proves acceptance, not just geometry.
        const accepted=state?.history.at(-1)?.raw===raw;
        if(!accepted){
          if(reuse&&saved){state!.candidateRegionId=saved.candidateRegionId;state!.candidateSince=saved.candidateSince;}
          if(memory)log(raw,memory,'not-counted','engine rejected/ignored packet; it cannot become evidence');
        }else if(state!.activeRegionId){
          if(reuse)log(raw,{...memory!,strongInsidePoints:memory!.strongInsidePoints+1,...(recent?{samples:recent}:{})},'confirmed',
            policy.sequence?'four-of-five / trailing-two alternative completed; native duration and door requirements passed':'normal engine requirements completed with resumed evidence');
          pending.delete(raw.tagCode);
        }else if(region){
          if(memory&&memory.roomId!==region.id){log(raw,memory,'discard','accepted different room');memory=undefined;}
          if(!memory){
            if(strong||!policy.sequence?.ignoreWeakInside){
              memory={roomId:region.id,since:measured,firstDelivery:delivered,lastMeasurement:measured,lastDelivery:delivered,
                strongInsidePoints:strong?1:0,outsidePoints:0,
                ...(policy.sequence?{samples:[{kind:strong?'inside':'weak',at:measured} as Sample]}:{})};
              pending.set(raw.tagCode,memory);log(raw,memory,'start','accepted in-room candidate');
            }
          }else{
            memory.lastMeasurement=measured;memory.lastDelivery=delivered;
            if(strong)memory.strongInsidePoints++;
            if(policy.sequence&&(strong||!policy.sequence.ignoreWeakInside))memory.samples=[...memory.samples!,{kind:strong?'inside':'weak',at:measured} as Sample].slice(-(requiredInside+1));
            if(policy.sequence?.ignoreWeakInside&&!strong)log(raw,memory,'weak-not-counted','weak inside point adds no evidence and does not erase strong evidence');
            if(reuse)log(raw,memory,'resumed','old strong evidence retained; outside is not inside evidence');
          }
        }else if(memory){
          memory.outsidePoints++;memory.lastMeasurement=measured;memory.lastDelivery=delivered;
          memory.firstOutsideMeasurement??=measured;memory.firstOutsideDelivery??=delivered;
          if(policy.sequence){
            const retained=policy.sequence.minimumInsidePoints==='map-minimum'?Math.max(4,memoryRegion!.settings.entryConfirmationCount):4;
            memory.samples=[...memory.samples!,{kind:'outside',at:measured} as Sample].slice(-(retained+1));
          }
          if(memory.outsidePoints>policy.maximumOutsidePoints){log(raw,memory,'discard','outside point limit exceeded');pending.delete(raw.tagCode);}
          else log(raw,memory,'outside-held','candidate memory only; no room assignment on outside point');
        }
        const packets=queued;queued=undefined;
        for(const p of packets){
          if(reuse&&accepted&&p.decisionTrace){publish({...p,decisionTrace:{...p.decisionTrace,reasons:[...p.decisionTrace.reasons,
            {code:policy.sequence?'EXPERIMENT_ENTRY_PATTERN_MATCHED':'EXPERIMENT_ENTRY_MEMORY_RESUMED',message:policy.sequence
              ?'Çevrimdışı deney: son pencerenin iç çoğunluğu ve son iki güvenilir iç ölçüm sağlandı; alternatif giriş kanıtı.'
              :'Çevrimdışı deney: kısa dış ölçüm sonrası önceki iç kanıt korundu; dış nokta iç kanıt değildir.'}]}});}
          else publish(p);
        }
        return output;
      },
      tick(){
        // No synthetic entry is created by this adapter. Native engine ticks remain intact.
        for(const [tag,memory] of pending)if(now()-memory.firstDelivery>policy.windowMs
          ||(memory.firstOutsideDelivery!==undefined&&now()-memory.firstOutsideDelivery>policy.returnWithinMs))pending.delete(tag);
        engine.tick();
      },
      disable(){pending.clear();engine.disable();},
    };
  };
}
