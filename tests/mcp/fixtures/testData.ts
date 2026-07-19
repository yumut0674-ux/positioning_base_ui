import { LocationError } from "../../../src/server/location/locationErrors";
import {
  successEnvelope, type ApiEnvelope, type CurrentLocationData, type EntityMatch, type LocationAtTimeData,
  type LocationHistoryData, type SearchEntitiesData,
} from "../../../src/server/location/location.types";
import type { LocationApiClient } from "../../../mcp/client/locationApiClient";
import type { LocationAtTimeInput, LocationHistoryInput, SearchEntitiesInput } from "../../../src/server/location/location.validation";

export const FIXED_NOW = new Date("2026-07-19T11:30:00.000Z");
export const now = () => new Date(FIXED_NOW);

export const MATCH = {
  entityId: 28, entityCode: "PALLET-028", name: "Palet 28",
  entityType: "product", tagCode: "TAG-028", status: "active",
} as const;

export function searchEnvelope(matches: readonly EntityMatch[] = [MATCH]): ApiEnvelope<SearchEntitiesData> {
  return successEnvelope({ matches }, matches.length === 0 ? "no_data" : matches.length > 1 ? "ambiguous" : "complete", [], now);
}

export function currentEnvelope(status: "live" | "stale" | "offline" = "live"): ApiEnvelope<CurrentLocationData> {
  const ageSeconds = status === "live" ? 12 : status === "stale" ? 120 : 600;
  return successEnvelope({
    entityId: 28, entityName: "Palet 28", tagCode: "TAG-028",
    position: { x: 13.4, y: 8.2, zoneName: "Ana Alan", floorPlanId: "hq-l1" },
    observedAt: new Date(FIXED_NOW.getTime() - ageSeconds * 1_000).toISOString(),
    ageSeconds, trackingStatus: status, battery: 84,
  }, status === "live" ? "complete" : "stale", [], now);
}

export function atEnvelope(found = true): ApiEnvelope<LocationAtTimeData> {
  return successEnvelope({
    entityId: 28, requestedAt: "2026-07-18T14:00:00+03:00",
    observedAt: found ? "2026-07-18T13:59:48+03:00" : null,
    differenceSeconds: found ? 12 : null,
    position: found ? { x: 7.8, y: 12.1, zoneName: "Depo A", floorPlanId: "hq-l1" } : null,
    tagCode: "TAG-028",
  }, found ? "complete" : "no_data", [], now);
}

export function historyEnvelope(): ApiEnvelope<LocationHistoryData> {
  return successEnvelope({
    entityId: 28, entityName: "Palet 28", from: "2026-07-18T00:00:00+03:00", to: "2026-07-19T00:00:00+03:00",
    format: "route_points", points: [{
      x: 7.8, y: 12.1, observedAt: "2026-07-18T13:59:48+03:00",
      zoneName: "Depo A", floorPlanId: "hq-l1", tagCode: "TAG-028", battery: 84,
    }], gaps: [], returnedCount: 1, sampled: false, sourcePointCount: 1,
  }, "complete", [], now);
}

export function zoneTimelineEnvelope(): ApiEnvelope<LocationHistoryData> {
  return successEnvelope({
    entityId: 28,
    entityName: "Palet 28",
    timeline: [
      {
        zoneName: "Oda 34", enteredAt: "2026-07-19T10:39:28+03:00",
        exitedAt: "2026-07-19T10:52:14+03:00", durationSeconds: 766,
      },
      {
        zoneName: "Oda 65", enteredAt: "2026-07-19T10:52:14+03:00",
        exitedAt: "2026-07-19T11:02:30+03:00", durationSeconds: 616,
      },
    ],
  }, "complete", [], now);
}

export class FixtureClient implements LocationApiClient {
  public searchResponse: ApiEnvelope<SearchEntitiesData> = searchEnvelope();
  public currentResponse: ApiEnvelope<CurrentLocationData> = currentEnvelope();
  public atResponse: ApiEnvelope<LocationAtTimeData> = atEnvelope();
  public historyResponse: ApiEnvelope<LocationHistoryData> = historyEnvelope();
  public error: LocationError | null = null;
  public lastInput: unknown;

  private result<T>(value: ApiEnvelope<T>): Promise<ApiEnvelope<T>> {
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve(value);
  }

  public searchEntities(input: SearchEntitiesInput) { this.lastInput = input; return this.result(this.searchResponse); }
  public getCurrentLocation(entityId: number) { this.lastInput = entityId; return this.result(this.currentResponse); }
  public getLocationAtTime(input: LocationAtTimeInput) { this.lastInput = input; return this.result(this.atResponse); }
  public getLocationHistory(input: LocationHistoryInput) { this.lastInput = input; return this.result(this.historyResponse); }
}

export function structured(result: { readonly structuredContent?: Record<string, unknown> }): Record<string, unknown> {
  if (!result.structuredContent) throw new Error("structuredContent eksik");
  return result.structuredContent;
}
