import { readFile } from 'node:fs/promises';
import { compileRegionsConfig } from '../../src/server/regionEngine/configLoader';
import { pointInPolygon } from '../../src/server/regionEngine/geometry';
import type { RegionsConfig } from '../../src/features/regions/types/region.types';
import { readDataset } from './importer';
import { ms, type RawRow } from './model';

const ids=[
  'test-731bd18d-b3c4-4be6-9db3-e1ef52824c36',
  'test-f447ebd6-5ea1-4a4a-8ef6-5ffe35865d79',
  'test-beaf7415-708a-44c5-99ce-d75e09c8992a',
  'test-50b72c22-92e4-4eee-aadb-991305237df5',
  'test-daf3b7d0-0c2d-4b5d-b3ee-b4670b106410',
  'test-88c29e66-5068-48ef-b79e-f04bf782b894',
  'test-1681d486-28ef-46f2-b835-10fc1fbc69be',
  'test-a8b42398-1132-4081-80bd-459792fd73c5',
  'test-356f3a73-fe97-4ba1-82e2-daafd92447ab',
];
const config=compileRegionsConfig(JSON.parse(await readFile('config/maps/spor-koridor/regions.json','utf8')) as RegionsConfig);
const percentile=(values:number[],p:number):number|null=>values.length?Math.round(values.sort((a,b)=>a-b)[Math.floor((values.length-1)*p)]*100)/100:null;
const valid=(row:RawRow):row is RawRow&{x:number;y:number;created_at:string}=>row.x!==null&&row.y!==null&&row.created_at!==null;
function pairedDistances(a:RawRow[],b:RawRow[]):number[] {
  const aa=a.filter(valid).sort((x,y)=>ms(x.created_at)-ms(y.created_at));
  const bb=b.filter(valid).sort((x,y)=>ms(x.created_at)-ms(y.created_at));
  const distances:number[]=[];let j=0;
  for(const row of aa){const time=ms(row.created_at);while(j+1<bb.length&&ms(bb[j+1].created_at)<=time)j++;
    const nearest=[bb[j],bb[j+1]].filter(Boolean).sort((x,y)=>Math.abs(ms(x.created_at)-time)-Math.abs(ms(y.created_at)-time))[0];
    if(nearest&&Math.abs(ms(nearest.created_at)-time)<=1000)distances.push(Math.hypot(row.x-nearest.x,row.y-nearest.y));
  }
  return distances;
}
for(const [index,id] of ids.entries()) {
  const {truth,rows,manifest}=await readDataset(id);
  const from=ms(truth.test.from),to=ms(truth.test.to);
  const scored=rows.filter(r=>r.created_at&&ms(r.created_at)>=from&&ms(r.created_at)<to);
  const tags=Object.keys(manifest.candidateTags);
  const evidence=tags.map(tag=>{
    const tagRows=scored.filter(r=>r.tag_code===tag&&valid(r));
    const visits=truth.visits.map(v=>{
      const selected=tagRows.filter(r=>ms(r.created_at!)>=ms(v.from)&&ms(r.created_at!)<ms(v.to));
      const region=config.regions.find(r=>r.id===v.roomId);
      const inside=region?selected.filter(r=>pointInPolygon({x:r.x!,y:r.y!},region)).length:0;
      return {roomId:v.roomId,packets:selected.length,insideExpectedRoom:inside,insideFraction:selected.length?Math.round(inside*100/selected.length):null};
    });
    return {tag,packetsInTest:tagRows.length,visits};
  });
  const pairs=[];
  for(let a=0;a<tags.length;a++)for(let b=a+1;b<tags.length;b++){
    const distances=pairedDistances(scored.filter(r=>r.tag_code===tags[a]),scored.filter(r=>r.tag_code===tags[b]));
    pairs.push({tags:[tags[a],tags[b]],matchedSamples:distances.length,medianMeters:percentile(distances,.5),p90Meters:percentile(distances,.9)});
  }
  console.log(JSON.stringify({test:index+1,id,context:'current-map raw spatial evidence; not a confirmed carrier assignment',evidence,pairs}));
}
