/** Characterization probes: passing records observed behavior, not a claim it is desirable. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {StepDistanceFilter} from '../../../src/server/regionEngine/StepDistanceFilter';
import {RegionPositionEngine} from '../../../src/server/regionEngine/RegionPositionEngine';
import {compileRegionsConfig} from '../../../src/server/regionEngine/configLoader';
const config=compileRegionsConfig(JSON.parse(readFileSync(new URL('../../../config/maps/necmettin-servis/regions.json',import.meta.url),'utf8')));
const origin=Date.parse('2026-10-13T10:00:00Z');
const point=(t:number,x:number,y=0)=>({tagCode:'ANON',x,y,timestamp:new Date(origin+t).toISOString()});
test('characterization: delivery-clock expiry can clear a measurement-time coherent candidate',()=>{
  const gates={speedOK:true,fresh:true,qualityOK:true,maximumSpeedMetersPerSecond:3,movementToleranceMeters:0.25};
  const a=new StepDistanceFilter(point(0,0)),b=new StepDistanceFilter(point(0,0));
  // The candidate must exceed the configured distance limit, including Servis D=10 m.
  const distantX=config.rules.maximumStepDistanceMeters+5;
  a.evaluate(point(1000,distantX),config.rules,gates);b.evaluate(point(1000,distantX),config.rules,gates);
  // B delivered at 2200; C measured at 2500 and delivered at 3700.
  // An intervening tick at 3101 sees B as 2101 ms old, although measurement gap B→C is 1500.
  a.expire(origin+3101,2000);
  assert.equal(a.evaluate(point(2500,distantX+0.2),config.rules,gates).outcome,'reject');
  assert.equal(b.evaluate(point(2500,distantX+0.2),config.rules,gates).outcome,'reset');
});
test('characterization: rejected distant input revives an expired active room',()=>{
  let now=origin;const engine=new RegionPositionEngine(()=>{},1000,()=>now,false);
  const p=config.regions[0].roomCenter;engine.enable(config);
  try{
    for(let i=0;i<6;i++){now=origin+i*1000;engine.ingest(point(i*1000,p.x,p.y));}
    assert.equal(engine.getVehicleState('ANON')?.state,'IN_REGION');
    now=origin+60000;engine.tick();assert.equal(engine.getVehicleState('ANON')?.state,'LOCATION_LOST');
    now+=10;const rejected=engine.ingest(point(60010,p.x+100,p.y));
    assert.ok(rejected?.decisionTrace?.reasons.some(r=>r.code==='MEASUREMENT_REJECTED_BY_DISTANCE'));
    assert.equal(rejected?.regionInference.state,'INFERRED_IN_REGION');
    assert.equal(engine.getVehicleState('ANON')?.lastRawDataTimestamp,origin+5000);
  }finally{engine.disable();}
});
