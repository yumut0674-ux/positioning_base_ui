import { locationService } from "@/src/server/location";
import { locationRoute } from "@/src/server/location/http";
import { locationAtTimeInputSchema } from "@/src/server/location/location.validation";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { readonly params: Promise<{ readonly entityId: string }> }) {
  return locationRoute(async () => {
    const query = new URL(request.url).searchParams;
    const input = locationAtTimeInputSchema.parse({
      entityId: Number((await params).entityId), at: query.get("at") ?? "",
      toleranceSeconds: query.has("toleranceSeconds") ? Number(query.get("toleranceSeconds")) : undefined,
    });
    return locationService.atTime(input.entityId, input.at, input.toleranceSeconds);
  });
}
