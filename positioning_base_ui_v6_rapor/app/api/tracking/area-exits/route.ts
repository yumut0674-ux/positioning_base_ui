import { areaExitReader } from "@/src/server/tracking/areaExitReader";
import { createAreaExitResponse } from "@/src/server/tracking/areaExitHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  return createAreaExitResponse(request, areaExitReader);
}
