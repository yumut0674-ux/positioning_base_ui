import type {Decision} from '../replay';

/** Integrate each scored tag independently; simultaneous tags are not one timeline. */
export function locationLostSeconds(decisions:Decision[],tags:string[],from:string,to:string):number {
  const start=Date.parse(from),end=Date.parse(to);
  let total=0;
  for(const tag of new Set(tags)){
    const events=decisions.filter(d=>d.tagCode===tag);
    for(let i=0;i<events.length;i++){
      if(events[i].state!=='LOCATION_LOST')continue;
      total+=Math.max(0,Math.min(end,Date.parse(events[i+1]?.at??to))-Math.max(start,Date.parse(events[i].at)));
    }
  }
  return total/1000;
}
