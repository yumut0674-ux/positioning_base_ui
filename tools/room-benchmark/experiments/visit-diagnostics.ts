import assert from 'node:assert/strict';
import {pointInPolygon,wallDistance} from '../../../src/server/regionEngine/geometry';
import type {compileRegionsConfig} from '../../../src/server/regionEngine/configLoader';
import type {Decision,Run} from '../replay';
import {round,type Truth,type RawRow,type Manifest} from '../model';
export const canonical=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export const countCodes=(decisions:Decision[])=>{
  const result:Record<string,number>={};
  for(const d of decisions)for(const code of new Set(d.reasonCodes))result[code]=(result[code]??0)+1;
  return result;
};
export const pct=(n:number,d:number)=>d?round(100*n/d):null;
export const median=(values:number[])=>values.length?[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)/2)]:null;
export function visitDiagnostics(rows:RawRow[],truth:Truth,manifest:Manifest,config:ReturnType<typeof compileRegionsConfig>,run:Run){
  const tag=truth.groups[0].tagCodes[0],events=run.decisions.filter(d=>d.tagCode===tag);
  const spans=truth.visits.map(()=>({sampledMs:0,confirmedMs:0,inferredMs:0,wrongMs:0,uncertainMs:0,exactConfirmedMs:0,exactInferredMs:0}));
  let i=0,current:Decision|undefined;
  for(let t=Date.parse(truth.test.from);t<Date.parse(truth.test.to);t+=run.simulation.sampleMs){
    const dt=Math.min(run.simulation.sampleMs,Date.parse(truth.test.to)-t),middle=t+dt/2;
    while(i<events.length&&Date.parse(events[i].at)<=middle)current=events[i++];
    const index=truth.visits.findIndex(v=>Date.parse(v.from)<=middle&&middle<Date.parse(v.to));
    if(index<0)continue;const c=spans[index];c.sampledMs+=dt;
    if(current?.roomId===truth.visits[index].roomId&&current.state==='IN_REGION')c.confirmedMs+=dt;
    else if(current?.roomId===truth.visits[index].roomId&&current.state==='INFERRED_IN_REGION')c.inferredMs+=dt;
    else if(current?.roomId&&['IN_REGION','INFERRED_IN_REGION'].includes(current.state))c.wrongMs+=dt;
    else c.uncertainMs+=dt;
  }
  for(let j=0;j<events.length;j++)for(let k=0;k<truth.visits.length;k++){
    const d=events[j],v=truth.visits[k];if(d.roomId!==v.roomId||!['IN_REGION','INFERRED_IN_REGION'].includes(d.state))continue;
    const dt=Math.max(0,Math.min(Date.parse(v.to),Date.parse(events[j+1]?.at??truth.test.to))-Math.max(Date.parse(v.from),Date.parse(d.at)));
    if(d.state==='IN_REGION')spans[k].exactConfirmedMs+=dt;else spans[k].exactInferredMs+=dt;
  }
  assert.equal(spans.reduce((n,c)=>n+c.confirmedMs,0),run.metrics.summary.correctConfirmedMs);
  assert.equal(spans.reduce((n,c)=>n+c.inferredMs,0),run.metrics.summary.correctInferredMs);
  return truth.visits.map((v,index)=>{
    const from=Date.parse(v.from),to=Date.parse(v.to),expected=config.regions.find(r=>r.id===v.roomId);
    if(!expected)throw Error(`Truth odası config'te yok: ${v.roomId}`);
    const selected=rows.filter(r=>r.tag_code===tag&&r.created_at&&Date.parse(r.created_at)>=from&&Date.parse(r.created_at)<to);
    const rawDetails=selected.map(r=>{
      const point={x:r.x!,y:r.y!},valid=r.x!==null&&r.y!==null&&Number.isFinite(r.x)&&Number.isFinite(r.y);
      const inside=valid&&pointInPolygon(point,expected),other=valid?config.regions.find(p=>p.id!==v.roomId&&pointInPolygon(point,p)):undefined;
      const corridor=valid&&config.corridors.some(p=>pointInPolygon(point,p));
      const shared=inside&&config.regions.some(p=>p.id!==v.roomId&&wallDistance(point,p)<expected.settings.sharedWallBandMeters);
      const band=shared?expected.settings.sharedWallBandMeters:expected.settings.wallBandMeters;
      const delivered=events.find(e=>!e.synthetic&&e.input.measuredAt===r.created_at&&e.input.receivedAt===r.received_at&&e.input.x===r.x&&e.input.y===r.y);
      const next=rows[rows.findIndex(n=>n.id===r.id)+1];
      const filtered=run.preprocessing?.pdop.rejected.find(n=>n.id===r.id);
      return {...r,classification:!valid?'missing-coordinate':inside?'expected-room':other?'other-room':corridor?'corridor':'outside-map',otherRoomId:other?.id??null,
        expectedWallDistance:inside?wallDistance(point,expected):null,expectedBandThreshold:inside?band:null,
        expectedDoorDistance:valid&&expected.entrances.length?Math.min(...expected.entrances.map(d=>Math.hypot(point.x-d.x,point.y-d.y))):null,
        sharedWallBand:shared,deliveredDecision:delivered??null,preprocessingRejection:filtered??null,
        nextSignalGapMs:next?.received_at&&r.received_at?Date.parse(next.received_at)-Date.parse(r.received_at):null};
    });
    const existing=(run.metrics.tags[tag].visits as {missed:boolean;entryDelayMs:number|null;exitDelayMs:number|null}[])[index];
    const during=events.filter(d=>Date.parse(d.at)>=from&&Date.parse(d.at)<to);
    return {index:index+1,...v,roomName:expected.name,durationSeconds:(to-from)/1000,...existing,...spans[index],
      roomPercent:pct(spans[index].confirmedMs+spans[index].inferredMs,spans[index].sampledMs),
      fleeting:spans[index].exactConfirmedMs+spans[index].exactInferredMs>0&&spans[index].exactConfirmedMs+spans[index].exactInferredMs<1000,
      rawSpatial:run.rawSpatialEvidence?.find(e=>e.visitIndex===index+1&&e.tagCode===tag),
      rawDetails,reasonCounts:countCodes(during),
      gaps:manifest.quality.largeGaps.filter(g=>Date.parse(g.to)>from&&Date.parse(g.from)<to),
      windowEvents:events.filter(d=>Date.parse(d.at)>=from-5000&&Date.parse(d.at)<=to+5000),
      roomConfiguration:{settings:expected.settings,polygon:expected.polygon,doors:expected.entrances}};
  });
}
