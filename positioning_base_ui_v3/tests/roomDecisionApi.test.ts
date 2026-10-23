import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/room-decisions/route";
import { defaultDecisionRange, roomDecisionQuerySchema } from "../src/server/location/roomDecision.validation";

test("room decision query validation is strict and enforces zoned dates and limits",async()=>{
  const invalid=[
    "from=2026-09-01T00%3A00%3A00&to=2026-09-01T01%3A00%3A00Z",
    "from=2026-09-01T02%3A00%3A00Z&to=2026-09-01T01%3A00%3A00Z",
    "limit=501",
    "unknown=value",
    "eventType=NOT_REAL",
  ];
  for(const query of invalid){const response=await GET(new Request(`http://localhost/api/room-decisions?${query}`));assert.equal(response.status,400,query);}
});

test("room decision query accepts all supported filters and defaults to one hour",()=>{
  const defaults=defaultDecisionRange(new Date("2026-09-01T01:00:00Z"));assert.equal(Date.parse(defaults.to)-Date.parse(defaults.from),3_600_000);
  const parsed=roomDecisionQuerySchema.parse({tagCode:"TAG-1",from:"2026-09-01T00:00:00+03:00",to:"2026-09-01T01:00:00+03:00",mapId:"map-a",regionId:"room-03",eventType:"ROOM_INFERRED",state:"INFERRED_IN_REGION",measurementKind:"estimated",engineVersion:"room-evidence-5",configVersion:"v1",importantOnly:"true",limit:"500"});
  assert.equal(parsed.limit,500);assert.equal(parsed.importantOnly,true);assert.equal(parsed.regionId,"room-03");
});
