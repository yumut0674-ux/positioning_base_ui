import { getMapRegions, putMapRegions } from "@/app/api/regions/route";
export const runtime = "nodejs";
type Context = { params: Promise<{ mapId: string }> };
export async function GET(_request: Request, context: Context) { return getMapRegions((await context.params).mapId); }
export async function PUT(request: Request, context: Context) { return putMapRegions((await context.params).mapId, request); }
