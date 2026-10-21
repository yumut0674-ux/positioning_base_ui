import type { ProcessedPosition } from "../regionEngine/types";
import type { PositionRecord } from "./location.types";

/** Do not extend a measured room visit beyond the decision's freshness interval. */
export function ageDecision(p: ProcessedPosition, at: string): ProcessedPosition {
  const d=p.regionInference, now=Date.parse(at);
  if (d.uncertainAfter && now >= Date.parse(d.uncertainAfter)) return { ...p, regionInference: { ...d, state: "LOCATION_LOST", measurementKind: "uncertain", regionId: null, reasons: ["Uzun ölçüm kesintisi; güncel oda belirsiz"] } };
  if (!d.validUntil || now < Date.parse(d.validUntil) || d.measurementKind !== "measured") return p;
  return { ...p, regionInference: { ...d, state: d.regionId ? "INFERRED_IN_REGION" : "LOCATION_LOST", measurementKind: d.regionId ? "estimated" : "uncertain", confidence: Math.min(d.confidence??0,0.65), reasons: ["Gerçek ölçüm kesildi; önceki konum tahmini"] } };
}
export function decisionZone(p: ProcessedPosition): string {
  const d = p.regionInference;
  if (d.measurementKind === "uncertain" || d.state === "LOCATION_LOST" || d.state === "ENTRY_CANDIDATE") return "Belirsiz";
  if (d.regionId) return `${d.regionName ?? d.regionId}${d.measurementKind === "estimated" ? " (tahmin)" : ""}`;
  return "Koridor";
}

/** Keep visit endpoints and extend freshness through uninterrupted measurements. */
export function compactDecisionHistory(decisions: readonly ProcessedPosition[]): ProcessedPosition[] {
  const byTag = new Map<string, ProcessedPosition[]>();
  for (const decision of decisions) {
    const list = byTag.get(decision.tagCode) ?? [];
    list.push(decision);
    byTag.set(decision.tagCode, list);
  }
  const result: ProcessedPosition[] = [];
  const withoutTrace = (p: ProcessedPosition): ProcessedPosition => {
    const point = { ...p };
    delete point.decisionTrace;
    delete point.rawPosition;
    return point;
  };
  const key = (p: ProcessedPosition) => JSON.stringify([p.mapId, p.sourceZoneId, p.sourceZoneName,
    p.regionInference.state, p.regionInference.regionId, p.regionInference.regionName, p.regionInference.measurementKind]);
  for (const list of byTag.values()) {
    list.sort((a, b) => Date.parse(a.publishedAt!) - Date.parse(b.publishedAt!));
    let first = list[0], last = first;
    const close = () => {
      const point = withoutTrace(first);
      result.push({ ...point, regionInference: { ...first.regionInference,
        validUntil: last.regionInference.validUntil, uncertainAfter: last.regionInference.uncertainAfter } });
      if (last !== first) {
        result.push(withoutTrace(last));
      }
    };
    for (const current of list.slice(1)) {
      const at = Date.parse(current.publishedAt!);
      if (key(current) !== key(last)
        || (last.regionInference.validUntil && at >= Date.parse(last.regionInference.validUntil))
        || (last.regionInference.uncertainAfter && at >= Date.parse(last.regionInference.uncertainAfter))) {
        close();
        first = current;
      }
      last = current;
    }
    close();
  }
  return result.sort((a, b) => Date.parse(a.publishedAt!) - Date.parse(b.publishedAt!));
}
export function projectHistory(raw: readonly PositionRecord[], decisions: readonly ProcessedPosition[], includeEvents: boolean): PositionRecord[] {
  const byTag = new Map<string, ProcessedPosition[]>();
  const exact = new Map<string, ProcessedPosition>();
  const successors = new Map<ProcessedPosition, ProcessedPosition | undefined>();
  for (const d of decisions) { const list = byTag.get(d.tagCode) ?? []; list.push(d); byTag.set(d.tagCode, list); }
  for (const list of byTag.values()) {
    list.sort((a,b) => Date.parse(a.publishedAt!) - Date.parse(b.publishedAt!));
    list.forEach((d,i) => { successors.set(d,list[i+1]); if (!d.synthetic) exact.set(`${d.tagCode}/${Date.parse(d.lastRawDataTimestamp)}`,d); });
  }
  const result = raw.map(p => {
    const list = byTag.get(p.tagCode) ?? [];
    let low=0, high=list.length;
    while(low<high) {const mid=(low+high)>>>1; if(Date.parse(list[mid].publishedAt!)<=Date.parse(p.observedAt)) low=mid+1;else high=mid;}
    const decision = exact.get(`${p.tagCode}/${Date.parse(p.observedAt)}`) ?? list[low-1];
    return decision ? { ...p, decision: ageDecision(decision, p.observedAt) } : p;
  });
  if (includeEvents) for (const d of decisions) {
    result.push({ tagCode: d.tagCode, x: d.rawPosition?.x ?? d.x, y: d.rawPosition?.y ?? d.y, observedAt: d.publishedAt!, gapBeforeSeconds: null, decision: d });
    for (const expiry of [d.regionInference.measurementKind === "measured" ? d.regionInference.validUntil : undefined, d.regionInference.uncertainAfter]) {
      if (!expiry) continue;
      const expires = Date.parse(expiry);
      const next = successors.get(d);
      if (!next || Date.parse(next.publishedAt!) > expires) result.push({ tagCode: d.tagCode, x: d.x, y: d.y, observedAt: new Date(expires).toISOString(), gapBeforeSeconds: null, decision: ageDecision(d, new Date(expires).toISOString()) });
    }
  }
  return result.sort((a,b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
}

/** Query boundaries are intervals of a decision, never additional raw observations. */
export function projectDecisionTimeline(raw: readonly PositionRecord[], decisions: readonly ProcessedPosition[], from: string, to: string): PositionRecord[] {
  const start=Date.parse(from),end=Date.parse(to);
  const projected=projectHistory(raw,decisions,true).filter(p=>Date.parse(p.observedAt)>=start&&Date.parse(p.observedAt)<=end);
  const tags=new Set(decisions.map(d=>d.tagCode));
  for(const tag of tags) for(const boundary of [from,to]) {
    const d=decisions.filter(p=>p.tagCode===tag&&Date.parse(p.publishedAt!)<=Date.parse(boundary)).at(-1);
    if(d) projected.push({tagCode:tag,x:d.x,y:d.y,observedAt:boundary,gapBeforeSeconds:null,decision:ageDecision(d,boundary)});
  }
  return projected.sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
}
