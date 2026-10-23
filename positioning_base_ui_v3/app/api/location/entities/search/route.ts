import { entityService } from "@/src/server/location";
import { locationRoute } from "@/src/server/location/http";
import { searchEntitiesInputSchema } from "@/src/server/location/location.validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return locationRoute(async () => {
    const params = new URL(request.url).searchParams;
    const input = searchEntitiesInputSchema.parse({
      query: params.get("q") ?? "",
      limit: params.has("limit") ? Number(params.get("limit")) : undefined,
    });
    return entityService.search(input.query, input.limit);
  });
}
