import { writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { SCENARIOS, generateScenario } from "./room_scenarios.js";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";
import { RegionPositionEngine } from "../src/server/regionEngine/RegionPositionEngine";
import { LegacyRegionPositionEngine } from "../src/server/regionEngine/LegacyRegionPositionEngine";
import type { RegionsConfig } from "../src/features/regions/types/region.types";
import type { ProcessedPosition } from "../src/server/regionEngine/types";

export function evaluateScenario(options: Parameters<typeof generateScenario>[0] = {}) {
  const scenario = generateScenario(options);
  let clock = scenario.startTime, packetIndex=0;
  const current=new Map<string,ProcessedPosition>(), legacy=new Map<string,ProcessedPosition>();
  const events: ProcessedPosition[]=[];
  const engine=new RegionPositionEngine(p=>{ current.set(p.tagCode,p); events.push(p); },250,()=>clock,false);
  const old=new LegacyRegionPositionEngine(p=>legacy.set(p.tagCode,p),250,()=>clock,{automaticTicks:false,logging:false});
  const config=compileRegionsConfig(scenario.config as RegionsConfig);
  engine.enable(config); old.enable(config);
  const metrics=()=>({falseEntries:0,missedEntries:0,wrongRoomSeconds:0,uncertainSeconds:0,correctSeconds:0,unassignedRoomSeconds:0,roomTruthSeconds:0,delayMs:[] as number[]});
  const scores={inference:metrics(),legacy:metrics()};
  const visit=new Map<string,{room:string|null;since:number;found:boolean}>();
  const previousWrong=new Map<string,string|null>();
  try {
    for(const truth of scenario.truth) {
      clock=truth.at;
      while(packetIndex<scenario.packets.length&&scenario.packets[packetIndex].at<=clock) {
        const packet=scenario.packets[packetIndex++];
        engine.ingest({...packet.raw,receivedAt:new Date(packet.at).toISOString()}); old.ingest(packet.raw);
      }
      engine.tick(); old.tick();
      for(const name of ["inference","legacy"] as const) {
        const result=(name==="inference"?current:legacy).get(truth.tagCode), score=scores[name], key=`${name}/${truth.tagCode}`;
        const d=result?.regionInference;
        const uncertain=!d||["LOCATION_LOST","ENTRY_CANDIDATE"].includes(d.state);
        const room=uncertain?null:d.regionId;
        if(uncertain) score.uncertainSeconds+=scenario.tickMs/1000;
        else if(room===truth.room) score.correctSeconds+=scenario.tickMs/1000;
        if(truth.room) score.roomTruthSeconds+=scenario.tickMs/1000;
        if(truth.room&&!room&&!uncertain) score.unassignedRoomSeconds+=scenario.tickMs/1000;
        const wrong=room&&room!==truth.room?room:null;
        if(wrong) { score.wrongRoomSeconds+=scenario.tickMs/1000; if(previousWrong.get(key)!==room) score.falseEntries++; }
        previousWrong.set(key,room);
        let v=visit.get(key);
        if(!v||v.room!==truth.room) { if(v?.room&&!v.found) score.missedEntries++; v={room:truth.room,since:clock,found:false}; visit.set(key,v); }
        if(v.room&&!v.found&&room===v.room) {v.found=true;score.delayMs.push(clock-v.since);}
      }
    }
    for(const [key,v] of visit) if(v.room&&!v.found) scores[key.startsWith("inference/")?"inference":"legacy"].missedEntries++;
  } finally {engine.disable();old.disable();}
  return {scenario:scenario.scenario,seed:scenario.seed,durationSeconds:(scenario.durationMs+scenario.tickMs)/1000,tagCount:options?.tagCount??1,scores,events,truth:scenario.truth,packets:scenario.packets};
}

export async function runEvaluation(args=process.argv.slice(2)) {
  const option=(name:string,fallback:string)=>{const i=args.indexOf(`--${name}`);return i<0?fallback:args[i+1];};
  const number=(name:string,fallback:number)=>Number(option(name,String(fallback)));
  const selection=option("scenario","all"), out=option("output","test_api/results");
  const options={seed:number("seed",42),tagCount:number("tags",1),speed:number("speed",1),noise:number("noise",0.05),loss:number("loss",0),outageMs:number("outage",40000),intervalMs:number("interval",1000),startTime:Date.parse(option("start-time","2026-09-01T00:00:00Z"))};
  const reports=(selection==="all"?SCENARIOS:[selection]).map(scenario=>evaluateScenario({...options,scenario}));
  await mkdir(out,{recursive:true});
  await writeFile(`${out}/reference-map.json`,JSON.stringify(generateScenario().config,null,2));
  await writeFile(`${out}/room-metrics.json`,JSON.stringify(reports.map(r=>({scenario:r.scenario,seed:r.seed,durationSeconds:r.durationSeconds,tagCount:r.tagCount,scores:r.scores})),null,2));
  const rows=reports.map(r=>{const n=r.scores.inference,o=r.scores.legacy;return `| ${r.scenario} | ${n.falseEntries} / ${o.falseEntries} | ${n.missedEntries} / ${o.missedEntries} | ${n.delayMs.map(d=>(d/1000).toFixed(2)).join(", ")||"—"} | ${n.wrongRoomSeconds} / ${o.wrongRoomSeconds} | ${n.uncertainSeconds} / ${o.uncertainSeconds} | ${(100*n.correctSeconds/(r.durationSeconds*r.tagCount)).toFixed(1)}% | ${n.unassignedRoomSeconds} |`;});
  await writeFile(`${out}/room-metrics.md`,[
    "# Deterministik oda çıkarımı değerlendirmesi", "", `Parametreler: ${JSON.stringify(options)}. Harita: üretilen reference-map.json; saha doğrulaması değildir.`, "",
    "Çift değerler yeni / eski motor sırasındadır. Gecikmeler yeni motorun her gerçek oda ziyaretini ilk doğru atadığı ana kadardır. Fiziksel giriş anı 250 ms gerçek rota örneklemesinden alınır. Yanlış giriş, yanlış bir oda atamasına değişimdir; çıkış gecikmesi ayrıca yanlış oda süresine dahildir.", "",
    "| Senaryo | Yanlış giriş yeni/eski | Kaçırılan ziyaret yeni/eski | Gecikme (sn) | Yanlış oda (sn) yeni/eski | Belirsiz (sn) yeni/eski | Doğru zaman yeni | Odadayken koridor sayılan sn yeni |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",...rows,"",
    "Belirsiz süre başarı sayılmaz. Doğru zaman oranı tüm tag-saniyeleri kullanır; böylece sürekli belirsiz kalan motor yüksek başarı alamaz. Tahmini doğru oda doğru zaman sayılır, ölçülen/tahmini durum ayrımı room-traces.json içinde korunur. Kaçırılan ziyaret, gerçek bir oda ziyareti boyunca hiç doğru atama olmamasıdır; geç atama gecikme metriğine ve koridor/belirsiz sürelerine yansır.",""
  ].join("\n"));
  await writeFile(`${out}/room-traces.json`,JSON.stringify(reports));
  console.table(reports.map(r=>({scenario:r.scenario,false:r.scores.inference.falseEntries,missed:r.scores.inference.missedEntries,wrongSec:r.scores.inference.wrongRoomSeconds,uncertainSec:r.scores.inference.uncertainSeconds,correctSec:r.scores.inference.correctSeconds,delayMs:r.scores.inference.delayMs.join(","),legacyWrongSec:r.scores.legacy.wrongRoomSeconds})));
  const endpoint=option("endpoint","");
  if(endpoint) {
    // Explicit replay only; shift the logical epoch to real time, retaining packet delays.
    for(const report of reports) {
      const started=Date.now(), epoch=report.truth[0].at;
      for(const packet of report.packets) {
        const wait=started+packet.at-epoch-Date.now(); if(wait>0) await new Promise(resolve=>setTimeout(resolve,wait));
        const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type:"position",tag_id:packet.raw.tagCode,x:packet.raw.x,y:packet.raw.y,timestamp:new Date(started+Date.parse(packet.raw.timestamp)-epoch).toISOString()})});
        if(!response.ok) throw new Error(`Replay HTTP ${response.status}`);
      }
    }
  }
  return reports;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) void runEvaluation().catch(e=>{console.error(e);process.exitCode=1;});
