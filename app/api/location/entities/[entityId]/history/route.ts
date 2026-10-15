import { locationService } from "@/src/server/location";
import { locationRoute } from "@/src/server/location/http";
import { locationHistoryInputSchema } from "@/src/server/location/location.validation";
import { renderHistoryMaps } from "@/src/server/location/historyMapRenderer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { readonly params: Promise<{ readonly entityId: string }> }) {
  const response = await locationRoute(async () => {
    const query = new URL(request.url).searchParams;
    const input = locationHistoryInputSchema.parse({
      entityId: Number((await params).entityId), from: query.get("from") ?? "", to: query.get("to") ?? "",
      format: query.get("format") ?? "", limit: query.has("limit") ? Number(query.get("limit")) : undefined,
      mapId: query.get("mapId") ?? undefined,
    });
    const result = await locationService.history(input);
    if (query.get("render") === "map" && "points" in result.data) {
      const renderedMaps = await renderHistoryMaps(result.data);
      const missingMap = result.data.points.some(point => point.mapId && !renderedMaps.some(entry => entry.map.id === point.mapId));
      return { ...result, data: { ...result.data, renderedMaps }, meta: { ...result.meta,
        dataStatus: missingMap && result.meta.dataStatus === "complete" ? "partial" : result.meta.dataStatus,
        warnings: [...result.meta.warnings, ...(missingMap ? ["Bazı eski kayıtlara ait kat planı bulunamadı; mevcut planlar gösteriliyor."] : [])],
      } };
    }
    return result;
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
