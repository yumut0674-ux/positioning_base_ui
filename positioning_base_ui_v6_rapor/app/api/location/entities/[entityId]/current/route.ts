import { locationService } from "@/src/server/location";
import { locationRoute } from "@/src/server/location/http";
import { currentLocationInputSchema } from "@/src/server/location/location.validation";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly entityId: string }> },
) {
  return locationRoute(async () => {
    const input = currentLocationInputSchema.parse({ entityId: Number((await params).entityId) });
    return locationService.current(input.entityId);
  });
}
