import { NextResponse } from "next/server";
import { DEFAULT_PDOP_FILTER_SETTINGS } from "../shared/tracking/pdop";
import { mapService, MapRequestError, type MapService } from "./maps/mapService";
import { mapTrackingFilterSettings, TrackingFilterConfigurationError } from "./trackingFilterSettings";

export function createTrackingFilterHandlers(maps: Pick<MapService, "getMapDetails"> = mapService, settings = mapTrackingFilterSettings) {
  const errorResponse = (error: unknown) => NextResponse.json({ error: error instanceof Error ? error.message : "PDOP filtre isteği başarısız" }, {
    status: error instanceof MapRequestError ? error.status : error instanceof TrackingFilterConfigurationError ? 503 : 400,
  });
  return {
    async get(mapId: string) {
      try {
        await maps.getMapDetails(mapId);
        return NextResponse.json({ mapId, settings: await settings.read(mapId, true), defaults: DEFAULT_PDOP_FILTER_SETTINGS }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) { return errorResponse(error); }
    },
    async put(mapId: string, request: Request) {
      try {
        await maps.getMapDetails(mapId);
        const saved = await settings.save(mapId, await request.json());
        return NextResponse.json({ mapId, settings: saved, defaults: DEFAULT_PDOP_FILTER_SETTINGS });
      } catch (error) { return errorResponse(error); }
    },
  };
}

// Handler persistence never reloads, disables or otherwise touches the room motor.
export const trackingFilterHandlers = createTrackingFilterHandlers();
