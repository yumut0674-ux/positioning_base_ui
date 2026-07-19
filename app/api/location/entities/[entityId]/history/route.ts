import { locationService } from "@/src/server/location";
import { locationRoute } from "@/src/server/location/http";
import { locationHistoryInputSchema } from "@/src/server/location/location.validation";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { readonly params: Promise<{ readonly entityId: string }> }) {
  return locationRoute(async () => {
    const query = new URL(request.url).searchParams;
    const input = locationHistoryInputSchema.parse({
      entityId: Number((await params).entityId), from: query.get("from") ?? "", to: query.get("to") ?? "",
      format: query.get("format") ?? "", limit: query.has("limit") ? Number(query.get("limit")) : undefined,
    });
    return locationService.history(input);
  });
}
