import { pointInPolygon } from '../../src/server/regionEngine/geometry';
import type { compileRegionsConfig } from '../../src/server/regionEngine/configLoader';
import { ms, type RawRow, type Truth } from './model';

export interface SpatialVisitEvidence {
  tagCode: string;
  visitIndex: number;
  roomId: string;
  packetCount: number;
  expectedRoomCount: number;
  otherRoomCounts: Record<string, number>;
  corridorCount: number;
  outsideMappedCount: number;
  missingCoordinatesCount: number;
}

export function spatialEvidence(rows: RawRow[], truth: Truth, config: ReturnType<typeof compileRegionsConfig>): SpatialVisitEvidence[] {
  const tags=[...new Set(truth.groups.flatMap(group=>group.tagCodes))];
  return tags.flatMap(tagCode=>truth.visits.map((visit,index)=>{
    const from=ms(visit.from),to=ms(visit.to);
    const selected=rows.filter(row=>row.tag_code===tagCode&&row.created_at!==null&&ms(row.created_at)>=from&&ms(row.created_at)<to);
    const evidence:SpatialVisitEvidence={tagCode,visitIndex:index+1,roomId:visit.roomId,packetCount:selected.length,
      expectedRoomCount:0,otherRoomCounts:{},corridorCount:0,outsideMappedCount:0,missingCoordinatesCount:0};
    const expected=config.regions.find(region=>region.id===visit.roomId);
    for(const row of selected) {
      if(row.x===null||row.y===null||!Number.isFinite(row.x)||!Number.isFinite(row.y)) {evidence.missingCoordinatesCount++;continue;}
      const point={x:row.x,y:row.y};
      if(expected&&pointInPolygon(point,expected)) {evidence.expectedRoomCount++;continue;}
      const other=config.regions.find(region=>region.id!==visit.roomId&&pointInPolygon(point,region));
      if(other) {evidence.otherRoomCounts[other.id]=(evidence.otherRoomCounts[other.id]??0)+1;continue;}
      if(config.corridors.some(corridor=>pointInPolygon(point,corridor))) {evidence.corridorCount++;continue;}
      evidence.outsideMappedCount++;
    }
    return evidence;
  }));
}
