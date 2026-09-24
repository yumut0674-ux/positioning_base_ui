import { ms, round, type RawRow, type Truth } from './model';
import type { Decision } from './replay';

type Counts={totalMs:number;correctConfirmedMs:number;correctInferredMs:number;wrongRoomMs:number;corridorFalseRoomMs:number;lostOrUncertainMs:number;outsideCorrectMs:number};
const empty=():Counts=>({totalMs:0,correctConfirmedMs:0,correctInferredMs:0,wrongRoomMs:0,corridorFalseRoomMs:0,lostOrUncertainMs:0,outsideCorrectMs:0});
const room=(d:Decision|undefined):string|null => d && ['IN_REGION','INFERRED_IN_REGION','EXIT_CANDIDATE'].includes(d.state)?d.roomId:null;
export function score(truth:Truth,decisions:Decision[],rows:RawRow[],stepMs=250,toleranceMs=2000) {
  if (stepMs<1 || toleranceMs<0) throw new Error('Geçersiz örnekleme/tolerans');
  const output:Record<string,{strict:Counts;tolerant:Counts;visits:unknown[];rooms:Record<string,Counts>;roomsTolerant:Record<string,Counts>;observationEvents:Decision[]}>={};
  const testFrom=ms(truth.test.from),testTo=ms(truth.test.to);
  for (const group of truth.groups) for (const tag of group.tagCodes) {
    const events=decisions.filter(d=>d.tagCode===tag).sort((a,b)=>ms(a.at)-ms(b.at));
    const tagRows=rows.filter(r=>r.tag_code===tag);
    const strict=empty(), tolerant=empty(),rooms:Record<string,Counts>={},roomsTolerant:Record<string,Counts>={};
    let i=0, current:Decision|undefined;
    const scoreOne=(target:Counts,actual:string|null,predicted:string|null,state:string|undefined,dt:number)=>{
      target.totalMs+=dt;
      if (actual===null) { if (predicted) target.corridorFalseRoomMs+=dt; else if (state==='TRACKING_OUTSIDE') target.outsideCorrectMs+=dt; else target.lostOrUncertainMs+=dt; }
      else if (predicted===actual && state==='IN_REGION') target.correctConfirmedMs+=dt;
      else if (predicted===actual && state==='INFERRED_IN_REGION') target.correctInferredMs+=dt;
      else if (predicted && ['IN_REGION','INFERRED_IN_REGION'].includes(state??'')) target.wrongRoomMs+=dt;
      else target.lostOrUncertainMs+=dt;
    };
    for (let t=testFrom;t<testTo;t+=stepMs) {
      const dt=Math.min(stepMs,testTo-t), midpoint=t+dt/2;
      while(i<events.length && ms(events[i].at)<=midpoint) current=events[i++];
      const visit=truth.visits.find(v=>ms(v.from)<=midpoint&&midpoint<ms(v.to));
      const actual=visit?.roomId??null, predicted=room(current);
      scoreOne(strict,actual,predicted,current?.state,dt);
      const boundary=truth.visits.some(v=>Math.abs(midpoint-ms(v.from))<=toleranceMs||Math.abs(midpoint-ms(v.to))<=toleranceMs);
      if (!boundary) scoreOne(tolerant,actual,predicted,current?.state,dt);
      if (actual) { rooms[actual]??=empty();scoreOne(rooms[actual],actual,predicted,current?.state,dt);
        if(!boundary) {roomsTolerant[actual]??=empty();scoreOne(roomsTolerant[actual],actual,predicted,current?.state,dt);} }
    }
    const visits=truth.visits.map((v,index)=>{
      const from=ms(v.from),to=ms(v.to),inVisit=events.filter(e=>ms(e.at)>=from&&ms(e.at)<to&&room(e)===v.roomId&&['IN_REGION','INFERRED_IN_REGION'].includes(e.state));
      const before=events.filter(e=>ms(e.at)<from).at(-1);
      const first=(room(before)===v.roomId&&['IN_REGION','INFERRED_IN_REGION'].includes(before?.state??''))?from:(inVisit[0]?ms(inVisit[0].at):null);
      const after=events.find(e=>ms(e.at)>=to&&room(e)!==v.roomId);
      const lastAtEnd=events.filter(e=>ms(e.at)<to).at(-1);
      const missed=first===null;
      const timeline=missed?events.filter(e=>ms(e.at)>=from-5000&&ms(e.at)<=to+5000).map(e=>{
        const raw=tagRows.filter(r=>r.created_at===e.input.measuredAt).at(-1);
        const next=tagRows.find(r=>r.created_at && ms(r.created_at)>ms(e.input.measuredAt));
        return {truthRoom:v.roomId,rawPoint:{x:e.input.x,y:e.input.y,measuredAt:e.input.measuredAt,dbId:raw?.id??null},deliveredAt:e.at,state:e.state,roomId:e.roomId,eventType:e.eventType,reasonCodes:e.reasonCodes,nextSignalGapMs:next?.received_at&&raw?.received_at?ms(next.received_at)-ms(raw.received_at):null};
      }):[];
      return {index:index+1,roomId:v.roomId,from:v.from,to:v.to,missed,entryDelayMs:first===null?null:Math.max(0,first-from),
        exitDelayMs:room(lastAtEnd)===v.roomId?(after?Math.max(0,ms(after.at)-to):null):0,
        timeline};
    });
    output[tag]={strict,tolerant,visits,rooms,roomsTolerant,observationEvents:events.filter(e=>ms(e.at)>testTo)};
  }
  const groups=truth.groups.map(g=>({id:g.id,tags:g.tagCodes,strict:g.tagCodes.reduce((sum,tag)=>{
    const c=output[tag]?.strict; if(c) for(const key of Object.keys(sum) as (keyof Counts)[]) sum[key]+=c[key];return sum;
  },empty()),rooms:Object.fromEntries(truth.visits.map(v=>v.roomId).filter((id,index,ids)=>ids.indexOf(id)===index).map(id=>{
    const total=empty();for(const tag of g.tagCodes) {const c=output[tag]?.rooms[id];if(c)for(const key of Object.keys(total) as (keyof Counts)[])total[key]+=c[key];}
    return [id,total];
  })),missedVisits:g.tagCodes.reduce((sum,tag)=>sum+(output[tag]?.visits as {missed:boolean}[]??[]).filter(v=>v.missed).length,0)}));
  const summary=Object.values(output).reduce((sum,v)=>{ for(const key of Object.keys(sum) as (keyof Counts)[]) sum[key]+=v.strict[key];return sum;},empty());
  const actualRoomMs=Object.values(output).reduce((sum,v)=>sum+Object.values(v.rooms).reduce((roomSum,c)=>roomSum+c.totalMs,0),0);
  return {tags:output,groups,summary,
    successPercent:summary.totalMs?round(100*(summary.correctConfirmedMs+summary.correctInferredMs+summary.outsideCorrectMs)/summary.totalMs):null,
    roomOnlySuccessPercent:actualRoomMs?round(100*(summary.correctConfirmedMs+summary.correctInferredMs)/actualRoomMs):null,
    actualRoomMs};
}
