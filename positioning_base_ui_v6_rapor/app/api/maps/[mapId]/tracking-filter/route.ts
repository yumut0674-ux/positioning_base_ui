import { trackingFilterHandlers } from "@/src/server/trackingFilterHttp";

export const runtime = "nodejs";
type Context = { params: Promise<{ mapId: string }> };

export async function GET(_request: Request, { params }: Context) {
  return trackingFilterHandlers.get((await params).mapId);
}

export async function PUT(request: Request, { params }: Context) {
  return trackingFilterHandlers.put((await params).mapId, request);
}
