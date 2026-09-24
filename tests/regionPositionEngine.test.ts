import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RegionPositionEngine, ROOM_ENGINE_VERSION } from "../src/server/regionEngine/RegionPositionEngine";
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
    point(t:number,x:number,y:number,tagCode="T",quality?:number){now=epoch+t;return engine.ingest({tagCode,x,y,timestamp:new Date(now).toISOString(),quality,sourceZoneId:"zone-a",sourceZoneName:"Zone A",mapId:"map-a"});},
    tick(t:number){now=epoch+t;engine.tick();return published.at(-1)!;},
    enter(){this.point(0,3,2);this.point(1000,3,2.5);return this.point(2000,3,3)!;}
  };
}
function setupConfig(config: RegionsConfig) {
  let now=epoch;const published:ProcessedPosition[]=[];
  const engine=new RegionPositionEngine(p=>published.push(p),250,()=>now,false);
  engine.enable(compileRegionsConfig(config));
  return {engine,published,config,
    point(t:number,x:number,y:number,tagCode="T",quality?:number){now=epoch+t;return engine.ingest({tagCode,x,y,timestamp:new Date(now).toISOString(),quality,mapId:config.map.mapId});},
    tick(t:number){now=epoch+t;engine.tick();return published.at(-1)!;}
  };
}
function sportsCorridorConfig(): RegionsConfig {
  return JSON.parse(readFileSync(new URL("../config/maps/spor-koridor/regions.json",import.meta.url),"utf8")) as RegionsConfig;
}
function orthopedicsConfig(): RegionsConfig {
  return JSON.parse(readFileSync(new URL("../config/maps/kat1-ortopedi/regions.json",import.meta.url),"utf8")) as RegionsConfig;
}
type September21Fixture = { readonly tagCode:string; readonly mapId:string; readonly positions:readonly (readonly [string,number,number,string|null])[] };
function september21Fixture(): September21Fixture {
  return JSON.parse(readFileSync(new URL("./fixtures/september21SporKoridorRoute.json",import.meta.url),"utf8")) as September21Fixture;
}
type DirectRoomSwitchFixture = { readonly mapId:string; readonly room05From06F:readonly (readonly [string,number,number])[]; readonly room05From9A8:readonly (readonly [string,number,number])[]; readonly room05From9A8PreviousFast:readonly (readonly [string,number,number])[]; readonly sparseD956:readonly (readonly [string,number,number])[] };
function directRoomSwitchFixture(): DirectRoomSwitchFixture {
  return JSON.parse(readFileSync(new URL("./fixtures/directRoomSwitchFieldFixtures.json",import.meta.url),"utf8")) as DirectRoomSwitchFixture;
}
function silentProximityConfig(base: RegionsConfig, distance = 1.5): RegionsConfig {
  return { ...base, regions: base.regions.map(region => ({ ...region, coverage: "silent" as const,
    inference: { ...region.inference, coverage: "silent" as const, silentEntryMaxDistanceMeters: distance } })) };
}
function requiredDoorConfig(base: RegionsConfig, coverage: "silent" | "regular" | "intermittent", distance = 1.5): RegionsConfig {
  return { ...base, regions: base.regions.map(region => ({ ...region, coverage,
    inference: { ...region.inference, coverage, silentEntryMaxDistanceMeters: coverage === "silent" ? distance : undefined,
      doorDefaults: { ...region.inference?.doorDefaults, evidenceMode: "required" as const } } })) };
}
test("disabled engine does not mutate input",()=>{const s=setup();s.engine.disable();assert.equal(s.point(0,1,1),undefined);});
test("kat1-ortopedi uses 4.5 m/s globally and for every effective region setting",()=>{
  const compiled=compileRegionsConfig(orthopedicsConfig());
  assert.equal(compiled.rules.maximumSpeedMetersPerSecond,4.5);
  assert.ok(compiled.regions.length>0);
  assert.ok(compiled.regions.every(region=>region.settings.maximumSpeedMetersPerSecond===4.5));
});
test("kat1-ortopedi accepts a reasonable 4.5 m/s step and rejects a jump beyond speed plus tolerance",()=>{
  const s=setupConfig(orthopedicsConfig());
  s.point(0,-10,-10);
  const atLimit=s.point(1000,-5.5,-10)!;
  assert.notEqual(atLimit.decisionTrace?.eventType,"MEASUREMENT_REJECTED");
  const rejected=s.point(2000,0,-10)!;
  assert.equal(rejected.decisionTrace?.eventType,"MEASUREMENT_REJECTED");
  assert.ok(rejected.decisionTrace?.reasons.some(reason=>reason.code==="MEASUREMENT_REJECTED_BY_SPEED"));
  assert.equal(s.engine.getVehicleState("T")!.lastRawPosition.x,-5.5);
  assert.equal(s.engine.getVehicleState("T")!.lastRawDataTimestamp,epoch+1000);
});
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
test("required door crossing can infer a silent concrete room when signal stops at the wall",()=>{
  const s=setup();
  const config={...s.config,regions:s.config.regions.map(r=>({...r,coverage:"silent" as const,inference:{
    ...r.inference,doorDefaults:{...r.inference?.doorDefaults,evidenceMode:"required" as const,allowEstimatedEntryAfterSignalLoss:true}
  }}))};
  s.engine.reload(compileRegionsConfig(config));
  s.point(0,3,-0.5);s.point(1000,3,0.2);
  const before=s.published.at(-1)!;
  assert.equal(before.regionInference.state,"ENTRY_CANDIDATE");
  assert.equal(s.engine.getVehicleState("T")!.insideConfirmationCount,0);
  const inferred=s.tick(9000);
  assert.equal(inferred.regionInference.state,"INFERRED_IN_REGION");
  assert.equal(inferred.regionInference.regionId,"A");
  assert.match(inferred.regionInference.reasons!.join(),/Beton oda kapısından/);
});
test("synthetic publications preserve measurement time, long gaps expose uncertainty",()=>{
  const s=setup();const entered=s.enter();const p=s.tick(7000);
  assert.equal(p.timestamp,entered.timestamp);assert.equal(p.lastRawDataTimestamp,entered.timestamp);
  assert.notEqual(p.publishedAt,p.timestamp);assert.equal(p.synthetic,true);
  assert.equal(p.mapId,"map-a");assert.equal(p.sourceZoneId,"zone-a");assert.equal(p.sourceZoneName,"Zone A");
  const lost=s.tick(40000);assert.equal(lost.regionInference.state,"LOCATION_LOST");assert.equal(lost.regionInference.regionId,null);
  assert.equal(lost.regionInference.lastKnownRegionId,"A");assert.deepEqual([lost.x,lost.y],[3,3]);
});
test("a single neighbor jump cannot replace a confirmed room, while a sustained direct sequence can",()=>{
  const s=setup({maximumSpeedMetersPerSecond:10});s.enter();
  assert.equal(s.point(3000,8,3)?.regionInference.regionId,"A");
  assert.equal(s.point(4000,8,3)?.regionInference.regionId,"A");
  assert.equal(s.point(5000,8,3)?.regionInference.regionId,"B");
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
  const s=setup();s.enter();s.tick(45000);s.point(46000,9,3);
  assert.equal(s.engine.getVehicleState("T")!.requiredDurationMs,3000);
  s.point(47000,9,3);s.point(48000,9,3);
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

test("confirmed corridor exit clears relocation before the next room entry", () => {
  const s=setup({ entryEvidenceDurationMs:1500, relocationEvidenceDurationMultiplier:2,
    maximumSpeedMetersPerSecond:10 });
  s.engine.reload(compileRegionsConfig(silentProximityConfig(s.config)));
  s.enter();s.tick(45000);
  assert.equal(s.engine.getVehicleState("T")!.relocation,true);
  s.point(46000,3,-1);s.point(47000,3,-1);s.point(48000,3,-1);
  const exited=s.point(49000,3,-1)!;
  assert.equal(exited.regionInference.state,"TRACKING_OUTSIDE");
  assert.ok(s.published.some(p=>p.decisionTrace?.eventType==="ROOM_EXITED"));
  assert.equal(s.engine.getVehicleState("T")!.relocation,false);
  const first=s.point(50000,9,2)!;
  assert.equal(first.regionInference.state,"ENTRY_CANDIDATE");
  assert.equal(s.engine.getVehicleState("T")!.requiredDurationMs,1500);
  s.point(51000,9,2.5);
  const confirmed=s.point(52557,9,3)!;
  assert.equal(confirmed.regionInference.regionId,"B");
  assert.equal(confirmed.decisionTrace?.eventType,"ROOM_CONFIRMED");
});

test("silent door proximity infers an estimated room from one corridor measurement and later becomes lost", () => {
  const s=setup();s.engine.reload(compileRegionsConfig(silentProximityConfig(s.config)));
  const measured=s.point(0,3,-1)!;
  assert.equal(measured.regionInference.regionId,null);
  assert.deepEqual(s.engine.getVehicleState("T")!.silentDoorCandidate,{regionId:"A",doorId:"door-0",distanceMeters:1,observedAt:epoch,source:"silent-door-proximity"});
  const inferred=s.tick(8000);
  assert.equal(inferred.regionInference.state,"INFERRED_IN_REGION");assert.equal(inferred.regionInference.regionId,"A");
  assert.equal(inferred.regionInference.measurementKind,"estimated");assert.equal(inferred.positionSource,"REGION_CENTER");
  assert.match(inferred.regionInference.reasons!.join(),/en yakın kapıya göre tahmini oda atandı \(door-0, 1\.00 m\)/);
  const diagnostic=s.engine.getStatus(3000,3001).diagnostics![0];
  assert.equal(diagnostic.silentDoorCandidateDoorId,"door-0");assert.equal(diagnostic.silentDoorDistanceMeters,1);
  assert.equal(s.tick(40000).regionInference.state,"LOCATION_LOST");
});

test("silent door proximity enforces distance and deterministically selects the nearest then first equal door", () => {
  const atLimit=setup();atLimit.engine.reload(compileRegionsConfig(silentProximityConfig(atLimit.config)));
  atLimit.point(0,3,-1.5);assert.equal(atLimit.engine.getVehicleState("T")!.silentDoorCandidate?.regionId,"A");

  const tooFar=setup();tooFar.engine.reload(compileRegionsConfig(silentProximityConfig(tooFar.config)));
  tooFar.point(0,3,-1.51);assert.equal(tooFar.engine.getVehicleState("T")!.silentDoorCandidate,null);
  assert.equal(tooFar.tick(8000).regionInference.regionId,null);

  const nearest=setup();nearest.engine.reload(compileRegionsConfig(silentProximityConfig(nearest.config,4)));
  nearest.point(0,8.5,-1);assert.equal(nearest.engine.getVehicleState("T")!.silentDoorCandidate?.regionId,"B");
  assert.equal(nearest.tick(8000).regionInference.regionId,"B");

  const tied=setup();tied.engine.reload(compileRegionsConfig(silentProximityConfig(tied.config,3.2)));
  tied.point(0,6,-1);assert.equal(tied.engine.getVehicleState("T")!.silentDoorCandidate?.regionId,"A");
  assert.equal(tied.tick(8000).regionInference.regionId,"A");
});

test("silent door proximity needs neither movement history nor movement toward the door", () => {
  const single=setup();single.engine.reload(compileRegionsConfig(silentProximityConfig(single.config)));
  single.point(0,3,-1);assert.equal(single.engine.getVehicleState("T")!.silentDoorCandidate?.doorId,"door-0");

  const away=setup();away.engine.reload(compileRegionsConfig(silentProximityConfig(away.config)));
  away.point(0,3,-.5);away.point(1000,3,-1);assert.equal(away.tick(9000).regionInference.regionId,"A");

  const parallel=setup();parallel.engine.reload(compileRegionsConfig(silentProximityConfig(parallel.config)));
  parallel.point(0,2.5,-1);parallel.point(1000,3,-1);assert.equal(parallel.tick(9000).regionInference.regionId,"A");
});

test("each accepted corridor measurement replaces or clears the silent door candidate", () => {
  const s=setup();s.engine.reload(compileRegionsConfig(silentProximityConfig(s.config)));
  s.point(0,3,-1);assert.equal(s.engine.getVehicleState("T")!.silentDoorCandidate?.regionId,"A");
  s.point(2000,9,-1);assert.equal(s.engine.getVehicleState("T")!.silentDoorCandidate?.regionId,"B");
  s.point(4000,6,-3);assert.equal(s.engine.getVehicleState("T")!.silentDoorCandidate,null);
});

test("configured corridor geometry prevents nearby non-corridor positions from becoming candidates", () => {
  const s=setup();const corridor={...s.config.regions[0],id:"corridor-far",name:"Uzak koridor",kind:"corridor" as const,roomCenter:null,entrances:[]};
  const config=silentProximityConfig({...s.config,regions:[corridor,...s.config.regions]});
  const compiled=compileRegionsConfig(config);assert.equal(compiled.corridors.length,1);s.engine.reload(compiled);
  s.point(0,3,-1);assert.equal(s.engine.getVehicleState("T")!.silentDoorCandidate,null);
});

test("regular and intermittent rooms and disabled proximity settings preserve existing behavior", () => {
  for(const coverage of ["regular","intermittent"] as const){const s=setup();const config={...s.config,regions:s.config.regions.map(region=>({...region,coverage,inference:{...region.inference,coverage,silentEntryMaxDistanceMeters:1.5}}))};
    s.engine.reload(compileRegionsConfig(config));s.point(0,3,-1);assert.equal(s.engine.getVehicleState("T")!.silentDoorCandidate,null);assert.equal(s.tick(8000).regionInference.regionId,null);}
  for(const distance of [0,undefined]){const s=setup();const config={...s.config,regions:s.config.regions.map(region=>({...region,coverage:"silent" as const,inference:{...region.inference,coverage:"silent" as const,silentEntryMaxDistanceMeters:distance}}))};
    s.engine.reload(compileRegionsConfig(config));s.point(0,3,-1);assert.equal(s.engine.getVehicleState("T")!.silentDoorCandidate,null);assert.equal(s.tick(8000).regionInference.regionId,null);}
});

test("ineligible doors never become silent proximity candidates", () => {
  const cases=[{enabled:false},{direction:"exit-only" as const},{evidenceMode:"ignored" as const},{allowEstimatedEntryAfterSignalLoss:false}];
  for(const inference of cases){const s=setup();const base=silentProximityConfig(s.config);const config={...base,regions:base.regions.map((region,index)=>index===0?{...region,entrances:region.entrances.map(door=>({...door,inference}))}:region)};
    s.engine.reload(compileRegionsConfig(config));s.point(0,3,-1);assert.equal(s.engine.getVehicleState("T")!.silentDoorCandidate,null);assert.equal(s.tick(8000).regionInference.regionId,null);}
});

test("real inside evidence supersedes a prior proximity-only inferred room", () => {
  const s=setup();s.engine.reload(compileRegionsConfig(silentProximityConfig(s.config)));
  s.point(0,3,-1);assert.equal(s.tick(8000).regionInference.regionId,"A");
  const firstInside=s.point(9000,9,3)!;assert.equal(firstInside.regionInference.state,"INFERRED_IN_REGION");assert.equal(firstInside.regionInference.regionId,"A");
  assert.equal(firstInside.regionInference.candidateRegionId,"B");
  s.point(10000,9,3);s.point(11000,9,3);const confirmed=s.point(12000,9,3)!;
  assert.equal(confirmed.regionInference.state,"IN_REGION");assert.equal(confirmed.regionInference.regionId,"B");assert.equal(confirmed.regionInference.measurementKind,"measured");
});

test("reliable silent-room evidence supersedes the corridor proximity candidate without using crossing direction", () => {
  const s=setup();s.engine.reload(compileRegionsConfig(silentProximityConfig(s.config)));
  s.point(0,3,-.5);s.point(1000,3,.6);
  assert.equal(s.engine.getVehicleState("T")!.silentDoorCandidate,null);
  const inferred=s.tick(9000);
  assert.equal(inferred.regionInference.regionId,"A");assert.match(inferred.regionInference.reasons!.join(),/Sessiz oda içinde güvenilir ölçüm/);
  assert.equal(s.engine.getVehicleState("T")!.silentDoorInferenceActive,false);
});

test("scenario A: reliable silent-room measurements confirm entry without a door crossing", () => {
  const s=setup();s.engine.reload(compileRegionsConfig(requiredDoorConfig(s.config,"silent")));
  assert.equal(s.point(0,3,3)!.regionInference.state,"ENTRY_CANDIDATE");
  const confirmed=s.point(1600,3,3)!;
  assert.equal(confirmed.regionInference.state,"IN_REGION");assert.equal(confirmed.regionInference.regionId,"A");
  assert.equal(confirmed.positionSource,"REGION_CENTER");assert.equal(confirmed.regionInference.measurementKind,"measured");
  assert.equal(confirmed.regionInference.confidence,.85);assert.equal(confirmed.engineVersion,ROOM_ENGINE_VERSION);
  assert.match(confirmed.regionInference.reasons!.join(),/Sessiz odada sürekli güvenilir iç ölçümler doğrulandı; kapı kanıtı aranmadı/);
  assert.doesNotMatch(confirmed.regionInference.reasons!.join(),/Zorunlu kapı/);
});

test("scenario B: the real Room 3 config confirms a long reliable inside replay without a door crossing", () => {
  const config=sportsCorridorConfig();const room=config.regions.find(region=>region.id==="room-03")!;const center=room.roomCenter!.world;
  const s=setupConfig(config);
  s.point(0,-.05,2.7);s.point(1000,-.1,2.7);
  let result:ProcessedPosition|undefined,confirmed:ProcessedPosition|undefined;
  for(let t=2000;t<=6000;t+=1000){result=s.point(t,center.x,center.y);if(!confirmed&&result?.regionInference.state==="IN_REGION")confirmed=result;}
  assert.equal(s.engine.getVehicleState("T")!.crossing,null);
  assert.equal(result!.regionInference.state,"IN_REGION");assert.equal(result!.regionInference.regionId,"room-03");
  assert.match(confirmed!.regionInference.reasons!.join(),/kapı kanıtı aranmadı/);
});

test("scenario C: the real Room 5 config confirms fourteen reliable inside samples without a door crossing", () => {
  const config=sportsCorridorConfig();const room=config.regions.find(region=>region.id==="room-05")!;const center=room.roomCenter!.world;
  const s=setupConfig(config);let result:ProcessedPosition|undefined;
  for(let index=0;index<14;index++) result=s.point(index*1000,center.x,center.y);
  assert.equal(s.engine.getVehicleState("T")!.crossing,null);
  assert.equal(result!.regionInference.state,"IN_REGION");assert.equal(result!.regionInference.regionId,"room-05");
  assert.doesNotMatch(result!.regionInference.reasons!.join(),/Zorunlu kapı girişi gözlenmedi/);
});

test("scenario B: one reliable silent-room measurement survives signal loss as a nonzero inference", () => {
  const s=setup();s.engine.reload(compileRegionsConfig(requiredDoorConfig(s.config,"silent")));
  const measured=s.point(0,3,3)!;assert.equal(measured.regionInference.state,"ENTRY_CANDIDATE");
  const inferred=s.tick(8000);
  assert.equal(inferred.regionInference.state,"INFERRED_IN_REGION");assert.equal(inferred.regionInference.regionId,"A");
  assert.ok(inferred.regionInference.confidence!>0);assert.ok(inferred.regionInference.confidence!<.85);
  assert.match(inferred.regionInference.reasons!.join(),/Sessiz oda içinde güvenilir ölçüm sonrası sinyal kesildi/);
});

test("scenario C: a reliable corridor point near a silent door infers entry without motion evidence", () => {
  const s=setup();s.engine.reload(compileRegionsConfig(requiredDoorConfig(s.config,"silent")));
  s.point(0,3,-1);
  const inferred=s.tick(8000);
  assert.equal(inferred.regionInference.state,"INFERRED_IN_REGION");assert.equal(inferred.regionInference.regionId,"A");
  assert.ok(inferred.regionInference.confidence!>0);assert.ok(inferred.regionInference.confidence!<.85);
  assert.match(inferred.regionInference.reasons!.join(),/door-0, 1\.00 m/);
});

test("silent-room raw evidence produces a stronger bounded inference than corridor proximity alone", () => {
  const inside=setup();inside.engine.reload(compileRegionsConfig(requiredDoorConfig(inside.config,"silent")));
  inside.point(0,3,3);const insideInference=inside.tick(8000);
  const corridor=setup();corridor.engine.reload(compileRegionsConfig(requiredDoorConfig(corridor.config,"silent")));
  corridor.point(0,3,-1);const corridorInference=corridor.tick(8000);
  assert.ok(insideInference.regionInference.confidence!>corridorInference.regionInference.confidence!);
  assert.ok(insideInference.regionInference.confidence!<=.65);assert.ok(corridorInference.regionInference.confidence!<=.65);
});

test("scenario D: corridor signal loss away from every silent door becomes location lost", () => {
  const s=setup();s.engine.reload(compileRegionsConfig(requiredDoorConfig(s.config,"silent")));
  s.point(0,6,-3);
  const lost=s.tick(8000);
  assert.equal(lost.regionInference.state,"LOCATION_LOST");assert.equal(lost.regionInference.regionId,null);
});

test("scenario E: data returning inside a proximity-inferred room keeps and confirms that room", () => {
  const reliable=setup();reliable.engine.reload(compileRegionsConfig(requiredDoorConfig(reliable.config,"silent")));
  reliable.point(0,3,-1);reliable.tick(8000);
  const confirmed=reliable.point(9000,3,3)!;
  assert.equal(confirmed.regionInference.state,"IN_REGION");assert.equal(confirmed.regionInference.regionId,"A");

  const wall=setup();wall.engine.reload(compileRegionsConfig(requiredDoorConfig(wall.config,"silent")));
  wall.point(0,3,-1);const inferred=wall.tick(8000);
  const retained=wall.point(9000,3,.1)!;
  assert.equal(retained.regionInference.state,"INFERRED_IN_REGION");assert.equal(retained.regionInference.regionId,"A");
  assert.equal(retained.regionInference.confidence,inferred.regionInference.confidence);
});

test("scenario F: seven reliable points confirm a required-door silent room without rejection", () => {
  const s=setup();s.engine.reload(compileRegionsConfig(requiredDoorConfig(s.config,"silent")));
  let result: ProcessedPosition | undefined;
  for(let t=0;t<=6000;t+=1000) result=s.point(t,3,3);
  assert.equal(result!.regionInference.state,"IN_REGION");assert.equal(result!.regionInference.regionId,"A");
  assert.doesNotMatch(result!.regionInference.reasons!.join(),/Zorunlu kapı girişi gözlenmedi/);
});

test("scenario G: one wall-band sample does not clear a proximity-inferred silent room", () => {
  const s=setup();s.engine.reload(compileRegionsConfig(requiredDoorConfig(s.config,"silent")));
  s.point(0,3,-1);s.tick(8000);
  const retained=s.point(9000,3,.1)!;
  assert.equal(retained.regionInference.state,"INFERRED_IN_REGION");assert.equal(retained.regionInference.regionId,"A");
});

test("scenario H: proximity inference chooses the nearest door without a movement vector", () => {
  const s=setup();s.engine.reload(compileRegionsConfig(requiredDoorConfig(s.config,"silent",4)));
  s.point(0,5.8,-1);
  assert.equal(s.engine.getVehicleState("T")!.silentDoorCandidate?.regionId,"A");
  assert.equal(s.tick(8000).regionInference.regionId,"A");
});

test("scenario G: a room-specific manual threshold change takes effect only after config reload", () => {
  const s=setup();const initial=silentProximityConfig(s.config,1.5);s.engine.reload(compileRegionsConfig(initial));
  s.point(0,3,-2);assert.equal(s.tick(8000).regionInference.state,"LOCATION_LOST");
  const updated={...initial,regions:initial.regions.map(region=>region.id==="A"
    ? {...region,inference:{...region.inference,silentEntryMaxDistanceMeters:2.2}}:region)};
  const compiled=compileRegionsConfig(updated);s.engine.reload(compiled);
  assert.equal(compiled.regions.find(region=>region.id==="A")!.settings.silentEntryMaxDistanceMeters,2.2);
  assert.equal(compiled.regions.find(region=>region.id==="B")!.settings.silentEntryMaxDistanceMeters,1.5);
  s.point(9000,3,-2);const inferred=s.tick(17000);
  assert.equal(inferred.regionInference.state,"INFERRED_IN_REGION");assert.equal(inferred.regionInference.regionId,"A");
});

test("scenario I: one impossible-speed packet is rejected without clearing a confirmed silent room", () => {
  const s=setup();s.engine.reload(compileRegionsConfig(requiredDoorConfig(s.config,"silent")));
  s.point(0,3,3);s.point(1000,3,3);const confirmed=s.point(2000,3,3)!;
  const before=s.engine.getVehicleState("T")!;const count=before.insideConfirmationCount;const evidenceCount=before.history.length;
  const anomaly=s.point(2100,100,100)!;const state=s.engine.getVehicleState("T")!;
  assert.equal(confirmed.regionInference.state,"IN_REGION");assert.equal(anomaly.regionInference.state,"INFERRED_IN_REGION");
  assert.equal(anomaly.regionInference.regionId,"A");assert.equal(state.activeRegionId,"A");
  assert.equal(state.insideConfirmationCount,count);assert.equal(state.history.length,evidenceCount);
  assert.equal(anomaly.rawPosition?.timestamp,confirmed.rawPosition?.timestamp);assert.equal(anomaly.lastRawDataTimestamp,confirmed.lastRawDataTimestamp);
  assert.match(anomaly.regionInference.reasons!.join(),/Hız sınırını aşan ölçüm/);
  const recovered=s.point(2200,3,3)!;
  assert.equal(recovered.regionInference.state,"IN_REGION");assert.equal(recovered.rawPosition?.timestamp,new Date(epoch+2200).toISOString());
});

test("a rejected low-quality packet does not postpone the accepted sample stale deadline", () => {
  const s=setup();s.engine.reload(compileRegionsConfig(requiredDoorConfig(s.config,"silent")));
  s.point(0,3,3);s.point(1000,3,3);const confirmed=s.point(2000,3,3)!;
  const rejected=s.point(9000,3,3,"T",0)!;
  assert.equal(rejected.rawPosition?.timestamp,confirmed.rawPosition?.timestamp);
  assert.equal(rejected.lastRawDataTimestamp,confirmed.lastRawDataTimestamp);
  const stale=s.tick(10001);
  assert.equal(stale.regionInference.state,"INFERRED_IN_REGION");assert.equal(stale.regionInference.regionId,"A");
  assert.equal(stale.lastRawDataTimestamp,confirmed.lastRawDataTimestamp);
});

test("scenario J: required-door regular and intermittent rooms retain their existing entry policy", () => {
  for(const coverage of ["regular","intermittent"] as const){
    const s=setup();const config={...s.config,regions:s.config.regions.map(region=>({...region,coverage,inference:{...region.inference,coverage,
      doorDefaults:{...region.inference?.doorDefaults,evidenceMode:"required" as const}}}))};
    s.engine.reload(compileRegionsConfig(config));let result:ProcessedPosition|undefined;
    for(let t=0;t<=6000;t+=1000) result=s.point(t,3,3);
    assert.equal(result!.regionInference.state,"ENTRY_CANDIDATE");assert.equal(result!.regionInference.regionId,null);
    assert.match(result!.regionInference.reasons!.join(),/Zorunlu kapı girişi gözlenmedi/);
  }
});

test("silent room exit needs continuous reliable corridor count and duration, not a required door", () => {
  const s=setup();s.engine.reload(compileRegionsConfig(requiredDoorConfig(s.config,"silent")));
  s.point(0,3,3);s.point(1000,3,3);s.point(2000,3,3);s.point(3000,3,1);
  const first=s.point(4000,3,-.6)!;
  assert.equal(first.regionInference.state,"EXIT_CANDIDATE");assert.equal(s.engine.getVehicleState("T")!.exitConfirmationCount,1);
  const second=s.point(4500,3,-.8)!;
  assert.equal(second.regionInference.state,"EXIT_CANDIDATE");assert.equal(s.engine.getVehicleState("T")!.exitConfirmationCount,2);
  const weakWall=s.point(6000,3,-.1)!;assert.equal(weakWall.regionInference.state,"EXIT_CANDIDATE");
  assert.equal(s.engine.getVehicleState("T")!.exitConfirmationCount,2);
  const exited=s.point(6500,3,-1)!;
  assert.equal(exited.regionInference.state,"TRACKING_OUTSIDE");assert.equal(exited.regionInference.regionId,null);
  assert.equal(exited.positionSource,"RAW");assert.deepEqual([exited.x,exited.y],[3,-1]);
  assert.match(exited.regionInference.reasons!.join(),/Sessiz odadan sürekli güvenilir koridor ölçümleriyle çıkış doğrulandı; kapı geçişi aranmadı/);
  const state=s.engine.getVehicleState("T")!;assert.equal(state.exitConfirmationCount,0);assert.equal(state.candidateRegionId,null);
  assert.deepEqual(state.lastReliableLocation,{kind:"corridor"});assert.equal(state.lastKnown,"A");
});

test("one corridor jump is cancelled by reliable room data and timer publications add no exit evidence", () => {
  const s=setup();s.engine.reload(compileRegionsConfig(requiredDoorConfig(s.config,"silent")));
  s.point(0,3,3);s.point(1000,3,3);s.point(2000,3,3);s.point(3000,3,1);s.point(4000,3,-.6);
  const before=s.engine.getVehicleState("T")!.exitConfirmationCount;s.tick(4200);s.tick(4400);
  assert.equal(s.engine.getVehicleState("T")!.exitConfirmationCount,before);
  const retained=s.point(5000,3,2)!;
  assert.equal(retained.regionInference.state,"IN_REGION");assert.equal(retained.regionInference.regionId,"A");
  assert.equal(s.engine.getVehicleState("T")!.exitConfirmationCount,0);
});

test("silent exit evidence resets after maxEvidenceGapMs and rejected packets never increment it", () => {
  const s=setup();s.engine.reload(compileRegionsConfig(requiredDoorConfig(s.config,"silent")));
  s.point(0,3,3);s.point(1000,3,3);s.point(2000,3,3);s.point(3000,3,1);s.point(4000,3,-.6);
  const rejected=s.point(4100,100,100)!;assert.match(rejected.regionInference.reasons!.join(),/Hız sınırını/);
  assert.equal(s.engine.getVehicleState("T")!.exitConfirmationCount,1);
  const lowQuality=s.point(4200,3,-.7,"T",.1)!;assert.match(lowQuality.regionInference.reasons!.join(),/Düşük donanım/);
  assert.equal(s.engine.getVehicleState("T")!.exitConfirmationCount,1);
  const restarted=s.point(8500,3,-.8)!;
  assert.equal(restarted.regionInference.state,"EXIT_CANDIDATE");assert.equal(s.engine.getVehicleState("T")!.exitConfirmationCount,1);
  const stillPending=s.point(9000,3,-1)!;assert.equal(stillPending.regionInference.state,"EXIT_CANDIDATE");
});

test("required-door regular and intermittent rooms still cannot exit through corridor evidence alone", () => {
  for(const coverage of ["regular","intermittent"] as const){
    const s=setup();s.engine.reload(compileRegionsConfig(requiredDoorConfig(s.config,"silent")));
    s.point(0,3,3);s.point(1000,3,3);s.point(2000,3,3);
    s.engine.reload(compileRegionsConfig(requiredDoorConfig(s.config,coverage)));
    s.point(3000,3,3);s.point(4000,1,1);let result:ProcessedPosition|undefined;
    for(let t=5000;t<=9000;t+=1000)result=s.point(t,1,-1);
    assert.equal(result!.regionInference.regionId,"A");assert.notEqual(result!.regionInference.state,"TRACKING_OUTSIDE");
    assert.match(result!.regionInference.reasons!.join(),/Zorunlu kapı çıkışı gözlenmedi/);
  }
});

test("after a doorless silent exit, dropout near another silent door infers that room by Euclidean distance", () => {
  const s=setup();s.engine.reload(compileRegionsConfig(requiredDoorConfig(s.config,"silent")));
  s.point(0,3,3);s.point(1000,3,3);s.point(2000,3,3);s.point(3000,3,1);s.point(4000,3,-.6);s.point(5000,3,-.8);s.point(5600,3,-1);
  s.point(6500,5,-1);s.point(7500,7,-1);s.point(8500,9,-1);
  const inferred=s.tick(16500);assert.equal(inferred.regionInference.state,"INFERRED_IN_REGION");assert.equal(inferred.regionInference.regionId,"B");

  const far=setup();far.engine.reload(compileRegionsConfig(requiredDoorConfig(far.config,"silent")));far.point(0,6,-3);
  const lost=far.tick(8000);assert.equal(lost.regionInference.state,"LOCATION_LOST");assert.equal(lost.regionInference.regionId,null);
});

test("21 September 2026 real route exits Rooms 3 and 5 without doors and infers Room 6 at the recorded cutoff", () => {
  const fixture=september21Fixture();const config=sportsCorridorConfig();let now=Date.parse(fixture.positions[0][0]);
  const published:ProcessedPosition[]=[];const engine=new RegionPositionEngine(position=>published.push(position),250,()=>now,false);
  engine.enable(compileRegionsConfig(config));
  const cutoff="2026-09-21T09:49:31.785Z";let speedRejectedExitCount=-1;
  for(const [timestamp,x,y,receivedAt] of fixture.positions){
    if(timestamp>cutoff)break;now=Date.parse(receivedAt??timestamp);
    const before=engine.getVehicleState(fixture.tagCode)?.exitConfirmationCount??0;
    const result=engine.ingest({tagCode:fixture.tagCode,mapId:fixture.mapId,timestamp,receivedAt:receivedAt??undefined,x,y});
    if(result?.decisionTrace?.reasons.some(reason=>reason.code==="MEASUREMENT_REJECTED_BY_SPEED")) {
      speedRejectedExitCount=engine.getVehicleState(fixture.tagCode)!.exitConfirmationCount;assert.equal(speedRejectedExitCount,before);
    }
  }
  const confirmations=published.filter(position=>position.decisionTrace?.eventType==="ROOM_CONFIRMED").map(position=>position.regionInference.regionId);
  assert.ok(confirmations.includes("room-03"));assert.ok(confirmations.includes("room-05"));assert.ok(speedRejectedExitCount>=0);
  const exits=published.filter(position=>position.decisionTrace?.eventType==="ROOM_EXITED");
  assert.ok(exits.some(position=>position.regionInference.lastKnownRegionId==="room-03"));
  assert.ok(exits.some(position=>position.regionInference.lastKnownRegionId==="room-05"));
  const state=engine.getVehicleState(fixture.tagCode)!;
  assert.equal(state.activeRegionId,null);assert.equal(state.lastReliableLocation?.kind,"corridor");
  assert.equal(state.silentDoorCandidate?.regionId,"room-06");assert.ok(Math.abs(state.silentDoorCandidate!.distanceMeters-.088)<.005);
  now=Date.parse(cutoff)+4_000;engine.tick();const inferred=published.at(-1)!;
  assert.equal(inferred.regionInference.state,"INFERRED_IN_REGION");assert.equal(inferred.regionInference.regionId,"room-06");
  assert.equal(inferred.engineVersion,ROOM_ENGINE_VERSION);
});

test("decision trace explains silent-door inference and far-corridor loss without changing the decision", () => {
  const near=setup();near.engine.reload(compileRegionsConfig(silentProximityConfig(near.config)));
  const measured=near.point(0,3,-1)!;const inferred=near.tick(8000);
  assert.equal(measured.decisionTrace?.eventType,"MEASUREMENT_ACCEPTED");
  assert.equal(inferred.regionInference.regionId,"A");assert.equal(inferred.decisionTrace?.eventType,"ROOM_INFERRED");
  assert.equal(inferred.decisionTrace?.previousState,"TRACKING_OUTSIDE");
  assert.equal(inferred.decisionTrace?.evidence?.doorId,"door-0");assert.equal(inferred.decisionTrace?.evidence?.doorDistanceMeters,1);
  assert.equal(inferred.decisionTrace?.evidence?.allowedDoorDistanceMeters,1.5);assert.equal(inferred.decisionTrace?.input.signalGapMs,8000);
  assert.equal(inferred.decisionTrace?.evidence?.lastReliableLocation?.x,3);
  assert.ok(inferred.decisionTrace?.reasons.some(reason=>reason.code==="SIGNAL_LOST_NEAR_SILENT_ROOM_DOOR"));

  const far=setup();far.engine.reload(compileRegionsConfig(silentProximityConfig(far.config)));far.point(0,6,-3);const lost=far.tick(8000);
  assert.equal(lost.decisionTrace?.eventType,"LOCATION_LOST");assert.ok(lost.decisionTrace?.reasons.some(reason=>reason.code==="NO_SUITABLE_DOOR_NEARBY"));
  assert.equal(lost.decisionTrace?.evidence?.doorDistanceMeters,undefined);
});

test("direct room switch requires three reliable target-room samples spread across configured time", () => {
  const s=setup({maximumSpeedMetersPerSecond:10});s.enter();
  const one=s.point(3000,9,3)!;
  assert.equal(one.regionInference.regionId,"A");assert.equal(one.regionInference.candidateRegionId,"B");
  assert.equal(s.engine.getVehicleState("T")!.roomSwitchCandidate?.confirmationCount,1);assert.equal(s.engine.getVehicleState("T")!.exitConfirmationCount,1);
  const two=s.point(4000,9,3)!;
  assert.equal(two.regionInference.regionId,"A");assert.equal(s.engine.getVehicleState("T")!.roomSwitchCandidate?.confirmationCount,2);assert.equal(s.engine.getVehicleState("T")!.exitConfirmationCount,2);
  const switched=s.point(4600,9,3)!;
  assert.equal(switched.regionInference.regionId,"B");assert.equal(switched.regionInference.state,"IN_REGION");
  assert.equal(switched.decisionTrace?.eventType,"ROOM_TRANSITIONED");assert.equal(switched.decisionTrace?.fromRegionId,"A");assert.equal(switched.decisionTrace?.toRegionId,"B");
  assert.equal(switched.decisionTrace?.confirmationCount,3);assert.equal(switched.decisionTrace?.collectedDurationMs,1600);
  assert.ok(switched.decisionTrace?.transitionId);assert.ok(switched.decisionTrace?.reasons.some(reason=>reason.code==="DIRECT_ROOM_SWITCH_CONFIRMED"));
  assert.equal(s.published.filter(position=>position.decisionTrace?.eventType==="ROOM_EXITED").length,0);
});

test("anonymized fast field fixtures confirm Room 3 to Room 5 without a corridor publication", () => {
  const fixture=directRoomSwitchFixture();
  for (const samples of [fixture.room05From06F,fixture.room05From9A8,fixture.room05From9A8PreviousFast]) {
    const s=setupConfig(sportsCorridorConfig());const first=Date.parse(samples[0][0]);
    for (const offset of [-6000,-4000,-2000]) s.point(first+offset-epoch,-1.013164,2.285254,"fixture-tag");
    let result:ProcessedPosition|undefined;
    for (const [timestamp,x,y] of samples) result=s.point(Date.parse(timestamp)-epoch,x,y,"fixture-tag");
    assert.equal(result!.regionInference.regionId,"room-05");assert.equal(s.published.filter(position=>position.decisionTrace?.eventType==="ROOM_TRANSITIONED").length,1);
    assert.equal(s.published.filter(position=>position.decisionTrace?.eventType==="ROOM_EXITED").length,0);
  }
});

test("sparse field fixture cannot confirm Room 5 or retain Room 3 after a long loss", () => {
  const samples=directRoomSwitchFixture().sparseD956;const s=setupConfig(sportsCorridorConfig());const first=Date.parse(samples[0][0]);
  for (const offset of [-6000,-4000,-2000]) s.point(first+offset-epoch,-1.013164,2.285254,"sparse-tag");
  for (const [timestamp,x,y] of samples) s.point(Date.parse(timestamp)-epoch,x,y,"sparse-tag");
  const lost=s.tick(Date.parse(samples[1][0])-epoch+60_000);
  assert.notEqual(lost.regionInference.regionId,"room-05");assert.equal(lost.regionInference.state,"LOCATION_LOST");assert.equal(lost.regionInference.lastKnownRegionId,"room-03");
});

test("an active old room still yields to the nearest silent target-door cutoff without directional movement", () => {
  const s=setup();const silent={...silentProximityConfig(s.config,1.5),engine:{...s.config.engine,maximumSpeedMetersPerSecond:10}};
  s.engine.reload(compileRegionsConfig(silent));s.enter();
  s.point(3000,9,-1);const inferred=s.tick(12000);
  assert.equal(inferred.regionInference.state,"INFERRED_IN_REGION");assert.equal(inferred.regionInference.regionId,"B");
  assert.equal(inferred.decisionTrace?.eventType,"ROOM_INFERRED");assert.ok(inferred.decisionTrace?.reasons.some(reason=>reason.code==="SIGNAL_LOST_NEAR_SILENT_ROOM_DOOR"));
});

test("direct room switch is cancelled by old-room support, restarted for a different target, and ignores rejected packets", () => {
  const cancelled=setup({maximumSpeedMetersPerSecond:10});cancelled.enter();cancelled.point(3000,9,3);
  cancelled.point(4000,3,3);assert.equal(cancelled.engine.getVehicleState("T")!.roomSwitchCandidate,null);assert.equal(cancelled.engine.getVehicleState("T")!.activeRegionId,"A");

  const base=scenarioConfig() as RegionsConfig;const roomB=base.regions[1];const withC={...base,engine:{...base.engine,maximumSpeedMetersPerSecond:20},regions:[...base.regions,{...roomB,id:"C",name:"C",entrances:[],polygon:roomB.polygon.map(point=>({ ...point, world:{...point.world,x:point.world.x+6},pixel:{...point.pixel,x:point.pixel.x+60} })),roomCenter:{...roomB.roomCenter!,world:{...roomB.roomCenter!.world,x:roomB.roomCenter!.world.x+6},pixel:{...roomB.roomCenter!.pixel,x:roomB.roomCenter!.pixel.x+60}}}]};
  const changed=setupConfig(withC);changed.point(0,3,2);changed.point(1000,3,2.5);changed.point(2000,3,3);changed.point(3000,9,3);changed.point(4000,15,3);
  const candidate=changed.engine.getVehicleState("T")!.roomSwitchCandidate;assert.equal(candidate?.toRegionId,"C");assert.equal(candidate?.confirmationCount,1);

  const rejected=setup();rejected.enter();const packet=rejected.point(2100,100,100)!;
  assert.equal(packet.decisionTrace?.eventType,"MEASUREMENT_REJECTED");assert.equal(rejected.engine.getVehicleState("T")!.roomSwitchCandidate,null);
});

test("insufficient direct room evidence does not retain the old room past roomSwitchUncertainAfterMs", () => {
  const s=setup({maximumSpeedMetersPerSecond:10});s.enter();s.point(3000,9,3);s.point(4000,9,3);
  const lost=s.tick(13000);
  assert.equal(lost.regionInference.state,"LOCATION_LOST");assert.equal(lost.regionInference.regionId,null);assert.equal(lost.regionInference.lastKnownRegionId,"A");assert.equal(lost.regionInference.candidateRegionId,"B");
});

test("decision trace snapshots entry evidence, required-door rejection, door crossing and exit", () => {
  const silent=setup();silent.engine.reload(compileRegionsConfig(requiredDoorConfig(silent.config,"silent")));
  silent.point(0,3,3);const confirmed=silent.point(1600,3,3)!;
  assert.equal(confirmed.decisionTrace?.eventType,"ROOM_CONFIRMED");
  assert.equal(confirmed.decisionTrace?.evidence?.collectedMeasurements,2);assert.equal(confirmed.decisionTrace?.evidence?.requiredMeasurements,2);
  assert.equal(confirmed.decisionTrace?.evidence?.collectedDurationMs,1600);assert.equal(confirmed.decisionTrace?.evidence?.requiredDurationMs,1500);
  assert.ok((confirmed.decisionTrace?.evidence?.score?.total??0)>0);assert.ok(confirmed.decisionTrace?.reasons.some(reason=>reason.code==="CONTINUOUS_INSIDE_EVIDENCE_CONFIRMED"));

  const required=setup();required.engine.reload(compileRegionsConfig(requiredDoorConfig(required.config,"regular")));
  let pending:ProcessedPosition|undefined;for(let t=0;t<=6000;t+=1000)pending=required.point(t,3,3);
  assert.equal(pending!.decisionTrace?.eventType,"ENTRY_CANDIDATE");assert.ok(pending!.decisionTrace?.reasons.some(reason=>reason.code==="REQUIRED_DOOR_EVIDENCE_MISSING"));
  assert.ok((pending!.decisionTrace?.evidence?.collectedMeasurements??0)>0);

  const crossing=setup();crossing.point(0,3,-.5);const crossed=crossing.point(1000,3,.6)!;
  assert.equal(crossed.decisionTrace?.evidence?.doorId,"door-0");assert.equal(crossed.decisionTrace?.eventType,"ENTRY_CANDIDATE");

  const exiting=setup();exiting.enter();exiting.point(3000,3,1);exiting.point(4000,3,.4);exiting.point(5000,3,-.4);
  const exitCandidate=exiting.point(6000,3,-1)!;const exited=exiting.point(7000,4,-1)!;
  assert.equal(exitCandidate.decisionTrace?.eventType,"EXIT_CANDIDATE");assert.equal(exited.decisionTrace?.eventType,"ROOM_EXITED");
});

test("decision trace classifies rejected measurements, long loss and config reload", () => {
  const speed=setup();speed.enter();const speedRejected=speed.point(2100,100,100)!;
  assert.equal(speedRejected.decisionTrace?.eventType,"MEASUREMENT_REJECTED");assert.equal(speedRejected.decisionTrace?.previousState,"IN_REGION");
  assert.ok(speedRejected.decisionTrace?.reasons.some(reason=>reason.code==="MEASUREMENT_REJECTED_BY_SPEED"));

  const quality=setup();quality.enter();const qualityRejected=quality.point(3000,3,3,"T",0)!;
  assert.ok(qualityRejected.decisionTrace?.reasons.some(reason=>reason.code==="MEASUREMENT_REJECTED_BY_QUALITY"));

  const stale=setup();stale.enter();stale.tick(30000);stale.engine.ingest({tagCode:"T",x:3,y:3,timestamp:new Date(epoch+3000).toISOString()});
  assert.ok(stale.published.at(-1)!.decisionTrace?.reasons.some(reason=>reason.code==="MEASUREMENT_REJECTED_AS_STALE"));
  const lost=stale.tick(40000);assert.equal(lost.decisionTrace?.eventType,"LOCATION_LOST");assert.ok(lost.decisionTrace?.reasons.some(reason=>reason.code==="LONG_SIGNAL_LOSS"));

  const reloaded=setup();reloaded.point(0,3,3);reloaded.engine.reload(compileRegionsConfig(reloaded.config));
  assert.equal(reloaded.published.at(-1)!.decisionTrace?.eventType,"CONFIG_RELOADED");assert.equal(reloaded.published.at(-1)!.decisionTrace?.trigger,"config_reload");
});

test("decision trace is an additive output and the established processed-position contract stays intact", () => {
  const s=setup();const position=s.point(0,3,-1)!;const {decisionTrace,...legacy}=position;
  assert.ok(decisionTrace);assert.deepEqual({tagCode:legacy.tagCode,x:legacy.x,y:legacy.y,timestamp:legacy.timestamp,mapId:legacy.mapId,positionSource:legacy.positionSource,state:legacy.regionInference.state,regionId:legacy.regionInference.regionId,candidateRegionId:legacy.regionInference.candidateRegionId,measurementKind:legacy.regionInference.measurementKind,confidence:legacy.regionInference.confidence,reasons:legacy.regionInference.reasons},
    {tagCode:"T",x:3,y:-1,timestamp:new Date(epoch).toISOString(),mapId:"map-a",positionSource:"RAW",state:"TRACKING_OUTSIDE",regionId:null,candidateRegionId:null,measurementKind:"measured",confidence:0,reasons:["Ölçülen koridor konumu; oda giriş kanıtı yok"]});
  assert.ok(!("decisionTrace" in legacy));
});
