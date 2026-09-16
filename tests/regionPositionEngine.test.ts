import assert from "node:assert/strict";
import test from "node:test";
import { RegionPositionEngine } from "../src/server/regionEngine/RegionPositionEngine";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import type { RegionsConfig } from "../src/features/regions/types/region.types";
import type { ProcessedPosition } from "../src/server/regionEngine/types";
import { scenarioConfig, generateScenario, SCENARIOS } from "../test_api/room_scenarios.js";
import { evaluateScenario } from "../test_api/evaluate_rooms";
import { ageDecision, projectHistory, decisionZone } from "../src/server/location/roomDecisionProjection";

const epoch=Date.parse("2026-09-01T00:00:00Z");
function setup(overrides: RegionsConfig["engine"]={}) {
  let now=epoch;
  const published: ProcessedPosition[]=[];
  const config={...scenarioConfig(),engine:{...scenarioConfig().engine,...overrides}} as RegionsConfig;
  const engine=new RegionPositionEngine(p=>published.push(p),250,()=>now,false);
  engine.enable(compileRegionsConfig(config));
  return {engine,published,config,
    point(t:number,x:number,y:number,tagCode="T",quality?:number){now=epoch+t;return engine.ingest({tagCode,x,y,timestamp:new Date(now).toISOString(),quality});},
    tick(t:number){now=epoch+t;engine.tick();return published.at(-1)!;},
    enter(){this.point(0,3,2);this.point(1000,3,2.5);return this.point(2000,3,3)!;}
  };
}
test("disabled engine does not mutate input",()=>{const s=setup();s.engine.disable();assert.equal(s.point(0,1,1),undefined);});
test("time and independent measurements are both required, even with count=1",()=>{
  const s=setup({entryConfirmationCount:1});
  assert.equal(s.point(0,3,3)?.regionInference.state,"ENTRY_CANDIDATE");
  assert.equal(s.point(1,3,3)?.positionSource,"RAW");
  assert.equal(s.point(1600,3,3)?.positionSource,"REGION_CENTER");
});
test("raw room motion always yields exact configured centre",()=>{
  const s=setup();s.enter();
  for(let t=3000;t<20000;t+=1000){const p=s.point(t,2+(t%3),2.5)!;assert.deepEqual([p.x,p.y],[3,3]);assert.equal(p.rawPosition?.x,2+(t%3));}
});
test("parallel door blackout and approach without crossing never assign a room",()=>{
  const s=setup();s.point(0,2,-0.5);s.point(1000,3,-0.5);
  assert.equal(s.tick(8000).regionInference.regionId,null);
  const a=setup();a.point(0,3,-1);a.point(1000,3,-0.4);
  assert.equal(a.tick(6000).regionInference.state,"ENTRY_CANDIDATE");
  assert.equal(a.tick(6000).regionInference.regionId,null);
});
test("directional door crossing and one strong inside measurement allow estimated entry, never measured entry",()=>{
  const s=setup();s.point(0,3,-0.5);s.point(1000,3,0.6);
  const before=s.published.at(-1)!;const p=s.tick(5000);
  assert.equal(before.regionInference.state,"ENTRY_CANDIDATE");
  assert.equal(p.regionInference.state,"INFERRED_IN_REGION");assert.equal(p.regionInference.regionId,"A");
  assert.ok(p.regionInference.confidence!<=before.regionInference.confidence!);
});
test("synthetic publications preserve measurement time, long gaps expose uncertainty",()=>{
  const s=setup();const entered=s.enter();const p=s.tick(7000);
  assert.equal(p.timestamp,entered.timestamp);assert.equal(p.lastRawDataTimestamp,entered.timestamp);
  assert.notEqual(p.publishedAt,p.timestamp);assert.equal(p.synthetic,true);
  const lost=s.tick(40000);assert.equal(lost.regionInference.state,"LOCATION_LOST");assert.equal(lost.regionInference.regionId,null);
  assert.equal(lost.regionInference.lastKnownRegionId,"A");assert.deepEqual([lost.x,lost.y],[3,3]);
});
test("single and short neighbor jumps cannot replace a confirmed room",()=>{
  const s=setup();s.enter();
  for(let t=3000;t<=6000;t+=1000) assert.equal(s.point(t,8,3)?.regionInference.regionId,"A");
  assert.equal(s.point(7000,3,3)?.positionSource,"REGION_CENTER");
});
test("wall measurements alone do not confirm adjacent room",()=>{
  const s=setup();for(let t=0;t<10000;t+=1000) assert.equal(s.point(t,6.1,3)?.regionInference.regionId,null);
});
test("confirmed door exit releases centre, subsequent room entry succeeds",()=>{
  const s=setup();s.enter();s.point(3000,3,1);s.point(4000,3,0.4);s.point(5000,3,-0.4);
  assert.equal(s.point(6000,3,-1)?.regionInference.state,"EXIT_CANDIDATE");
  assert.equal(s.point(7000,4,-1)?.positionSource,"RAW");
  s.point(8000,6,-1);s.point(9000,9,-1);s.point(10000,9,1);s.point(11000,9,2);
  assert.equal(s.point(12000,9,3)?.regionInference.regionId,"B");
});
test("long blackout allows relocation without invented transition time",()=>{
  const s=setup();s.enter();s.tick(45000);s.point(46000,9,3);s.point(47000,9,3);s.point(48000,9,3);
  const p=s.point(49000,9,3)!;assert.equal(p.regionInference.regionId,"B");assert.match(p.regionInference.reasons!.join(),/geçiş zamanı bilinmiyor/);
});
test("old, duplicate, delayed and low quality packets add no confirmation evidence",()=>{
  const s=setup();s.point(0,3,3);s.point(1000,3,3);
  const n=s.engine.getVehicleState("T")!.insideConfirmationCount;
  assert.equal(s.point(1000,3,3),undefined);assert.equal(s.point(500,3,3),undefined);
  assert.equal(s.engine.getVehicleState("T")!.insideConfirmationCount,n);
  s.point(2000,3,3,"T",0.1);assert.equal(s.engine.getVehicleState("T")!.insideConfirmationCount,n);
  s.tick(30000);s.engine.ingest({tagCode:"T",x:3,y:3,timestamp:new Date(epoch+3000).toISOString()});
  assert.equal(s.engine.getVehicleState("T")!.insideConfirmationCount,n);
});
test("long evidence gaps reset candidates instead of finishing old counters",()=>{
  const s=setup();s.point(0,3,3);assert.equal(s.point(10000,3,3)?.regionInference.state,"ENTRY_CANDIDATE");
});
test("tag histories and tag count are bounded and independent",()=>{
  const s=setup({historySize:5,maxTags:2});
  for(let t=0;t<100000;t+=100) s.point(t,3,3);
  assert.ok(s.engine.getVehicleState("T")!.history.length<=5);
  s.point(100000,9,3,"U");s.point(100100,9,3,"V");
  assert.equal(s.engine.getVehicleState("T"),undefined);assert.equal(s.engine.getVehicleState("U")!.activeRegionId,null);
});
test("coverage profiles affect dropout timing without raising entry confidence",()=>{
  const s=setup();const config={...s.config,regions:s.config.regions.map(r=>({...r,coverage:"silent" as const,expectedIntervalMs:2000}))};
  s.engine.reload(compileRegionsConfig(config));s.enter();
  assert.equal(s.tick(7000).regionInference.state,"IN_REGION");
  assert.equal(s.tick(19000).regionInference.state,"INFERRED_IN_REGION");
});
test("missing doors and narrow rooms report limitations without fabricated geometry",()=>{
  const s=setup();const c=compileRegionsConfig({...s.config,regions:s.config.regions.map(r=>({...r,entrances:[],wallBandMeters:4}))});
  assert.ok(c.warnings!.some(w=>w.startsWith("Oda A: kapı yok")));assert.ok(c.warnings!.some(w=>w.includes("dar oda")));
  assert.ok(c.warnings!.every(w=>!w.startsWith("A:")&&!w.startsWith("B:")));
  const corridor={...s.config.regions[0],id:"corridor-main",name:"Koridor",kind:"corridor" as const,roomCenter:null,entrances:[]};
  assert.deepEqual(compileRegionsConfig({...s.config,regions:[corridor]}).warnings,[]);
  assert.equal(c.regions[0].entrances.length,0);
  assert.throws(()=>compileRegionsConfig({...s.config,engine:{expectedIntervalMs:-1}}));
});
test("live decisions project to history and expiry is not a measured room visit",()=>{
  const s=setup();const p=s.enter();
  const raw=[{tagCode:"T",x:2,y:2,observedAt:p.timestamp,gapBeforeSeconds:null}];
  const history=projectHistory(raw,s.published,true);
  const same=history.find(r=>r.observedAt===p.timestamp)!;
  assert.deepEqual(same.decision?.regionInference,p.regionInference);
  assert.equal(decisionZone(ageDecision(p,new Date(epoch+20000).toISOString())),"Oda A (tahmin)");
  assert.equal(decisionZone(ageDecision(p,new Date(epoch+40000).toISOString())),"Belirsiz");
  assert.ok(history.some(p=>p.decision?.regionInference.measurementKind==="uncertain"));
});
test("reference scenarios reproduce exactly; adding tags cannot change tag one",()=>{
  const a=generateScenario({scenario:"neighbor-jumps",seed:17});const b=generateScenario({scenario:"neighbor-jumps",seed:17,tagCount:3});
  assert.deepEqual(a,generateScenario({scenario:"neighbor-jumps",seed:17}));
  assert.deepEqual(a.packets,b.packets.filter(p=>p.raw.tagCode==="SIM-001"));
  assert.ok(a.packets.every(p=>!("room" in p.raw)&&!("truth" in p.raw)));
});
test("all scenarios include useful correct coverage, room visits are not hidden by uncertainty",()=>{
  for(const scenario of SCENARIOS){const r=evaluateScenario({scenario,seed:42});assert.equal(r.scores.inference.missedEntries,0,scenario);assert.ok(r.scores.inference.correctSeconds/r.durationSeconds>(scenario==="entry-gap"?0.2:0.4),scenario);}
});

test("physical scenario routes cross room boundaries only at defined doors", () => {
  for (const scenario of SCENARIOS) {
    const { truth } = generateScenario({scenario});
    for(let i=1;i<truth.length;i++) {
      const a=truth[i-1],b=truth[i];
      assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<=0.251,scenario);
      if(a.room!==b.room) {
        assert.ok(!a.room||!b.room,`${scenario}: room-to-room wall crossing`);
        const doorX=(a.room??b.room)==="A"?3:9;
        assert.ok(Math.abs(a.x-doorX)<0.7&&Math.abs(b.x-doorX)<0.7,scenario);
        assert.ok(Math.abs(a.y)<0.3&&Math.abs(b.y)<0.3,scenario);
      }
    }
  }
});

test("candidate confidence cannot increase during a blackout, including the lost transition", () => {
  const s=setup();const p=s.point(0,3,3)!;
  assert.ok(s.tick(40000).regionInference.confidence!<=p.regionInference.confidence!);
});

test("sustained corridor measurements after a long gap release an old room", () => {
  const s=setup();s.enter();s.tick(45000);
  s.point(46000,7,-1);s.point(47000,7,-1);s.point(48000,7,-1);
  const p=s.point(49000,7,-1)!;
  assert.equal(p.regionInference.state,"TRACKING_OUTSIDE");assert.equal(p.regionInference.regionId,null);assert.equal(p.regionInference.lastKnownRegionId,"A");
});
