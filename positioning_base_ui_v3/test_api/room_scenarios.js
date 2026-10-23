/** Synthetic reference map, deliberately separate from the site's uncalibrated floor plan. */
export const SCENARIOS = ["corridor", "parallel-gap", "door-turnback", "entry-gap", "inside-long-gap", "room-motion", "shared-wall-noise", "neighbor-jumps", "door-transfer", "relocation", "first-inside", "packet-order", "variable-stream-gap"];
const pair = (x,y) => ({ pixel: {x,y}, world: {x,y} });
export function scenarioConfig() {
  return { map: { source: "system", mapId: "simulation-reference", image: "/test.png", widthPx: 120, heightPx: 80, calibration: { type: "affine", points: [] } },
    engine: { evidenceDurationMs: 1500, expectedIntervalMs: 1000 },
    regions: [0,1].map(i => ({ id: i ? "B" : "A", name: i ? "Oda B" : "Oda A", kind: "room", color: "#00a896", coverage: "regular",
      polygon: [pair(i*6,0),pair(i*6+6,0),pair(i*6+6,6),pair(i*6,6)], roomCenter: pair(i*6+3,3),
      entrances: [{ ...pair(i*6+3,0), id: `door-${i}`, label: "Kapı", widthMeters: 1.4, inwardNormal: {x:0,y:1}, connectsTo: "corridor", approachDepthMeters: 2, crossingDepthMeters: 0.15 }] })) };
}
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const roomAt = p => p.y > 0 && p.y < 6 && p.x > 0 && p.x < 12 ? (p.x < 6 ? "A" : "B") : null;
function route(waypoints, speed) {
  const frames = [{ at: 0, x: waypoints[0][0], y: waypoints[0][1] }];
  for (const [x,y,hold=0] of waypoints) {
    const prev = frames.at(-1);
    frames.push({ at: prev.at + Math.hypot(x-prev.x,y-prev.y)/speed*1000, x,y });
    if (hold) frames.push({at: frames.at(-1).at+hold,x,y});
  }
  return { duration: frames.at(-1).at, at(time) { const b = frames.find(f => f.at > time); if (!b) return frames.at(-1); const a = frames[frames.indexOf(b)-1]; const t=(time-a.at)/(b.at-a.at); return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}; } };
}

/** Ground truth never appears in packets. Every tag has its own random stream. */
export function generateScenario({ scenario="corridor", seed=42, tagCount=1, speed=1, noise=0.05, loss=0, outageMs=40000, intervalMs=1000, startTime=Date.parse("2026-09-01T00:00:00Z") }={}) {
  if (!SCENARIOS.includes(scenario)) throw new Error(`Unknown scenario: ${scenario}`);
  if (![speed,intervalMs,tagCount].every(x=>Number.isFinite(x)&&x>0) || tagCount>1000 || !Number.isInteger(tagCount) || noise<0 || loss<0 || loss>1 || outageMs<0 || !Number.isFinite(startTime)) throw new Error("Invalid simulation options");
  let points;
  if (["corridor","parallel-gap","variable-stream-gap"].includes(scenario)) points=[[1,-1,2000],[11,-1,10000],[1,-1,10000]];
  else if (scenario==="door-turnback") points=[[3,-1,1000],[3,-0.4,5000],[1,-1,5000]];
  else if (["door-transfer","relocation"].includes(scenario)) points=[[3,-1,1000],[3,3,6000],[3,-1,3000],[9,-1,1000],[9,3,outageMs+10000]];
  else if (scenario==="entry-gap") points=[[3,-1],[3,-0.4,1000],[3,3,outageMs+16000]];
  else if (scenario==="first-inside") points=[[3,3,10000],[4,4,5000]];
  else if (scenario==="shared-wall-noise") points=[[3,-1,1000],[3,3,6000],[5.9,3,12000],[3,3,6000]];
  else points=[[3,-1,1000],[3,3,6000],[4.5,4,4000],[2,2,outageMs+10000]];
  const physical=route(points,speed);
  const tickMs=250, durationMs=Math.ceil(physical.duration/tickMs)*tickMs;
  const truth=[], packets=[];
  for(let tag=0;tag<tagCount;tag++) {
    const random=seededRandom(seed+tag*104729), tagCode=`SIM-${String(tag+1).padStart(3,"0")}`;
    let next=0, previousPacket=null, sequence=0;
    for(let time=0;time<=durationMs;time+=tickMs) {
      const p=physical.at(time), room=roomAt(p);
      truth.push({ at:startTime+time,tagCode,x:p.x,y:p.y,room });
      if(time<next) continue;
      const variable=scenario==="variable-stream-gap" ? (sequence%3===0?500:sequence%3===1?1500:2500) : intervalMs;
      next=time+variable; sequence++;
      const entry=1000+1000/speed;
      const gap = scenario==="parallel-gap" ? time>=2000&&time<5000
        : scenario==="entry-gap" ? time>=entry&&time<entry+outageMs
        : scenario==="inside-long-gap" ? time>=8000&&time<8000+outageMs
        : scenario==="relocation" ? time>=10000&&time<10000+outageMs
        : scenario==="variable-stream-gap" ? time>=6000&&time<16000 : false;
      if(gap || random()<loss) continue;
      let x=p.x+(random()*2-1)*noise, y=p.y+(random()*2-1)*noise;
      if(scenario==="shared-wall-noise"&&p.x>5.8) x=5.9+(random()*2-1)*0.45;
      if(scenario==="neighbor-jumps"&&(time===9000||(time>=14000&&time<=18000))) {x=8.8;y=3;}
      const raw={tagCode,x,y,timestamp:new Date(startTime+time).toISOString()};
      packets.push({at:startTime+time,raw});
      if(scenario==="packet-order"&&previousPacket&&sequence%3===0) {
        packets.push({at:startTime+time+250,raw});
        packets.push({at:startTime+time+500,raw:previousPacket});
        packets.push({at:startTime+time+7000,raw});
      }
      previousPacket=raw;
    }
  }
  packets.sort((a,b)=>a.at-b.at); truth.sort((a,b)=>a.at-b.at||a.tagCode.localeCompare(b.tagCode));
  return {scenario,seed,startTime,durationMs,tickMs,config:scenarioConfig(),truth,packets};
}
