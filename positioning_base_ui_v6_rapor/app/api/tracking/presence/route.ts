import { tagPresenceRuntime } from "@/src/server/tracking/tagPresenceRuntime";
import { createTagPresenceResponse } from "@/src/server/tracking/tagPresenceHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  await tagPresenceRuntime.start();
  return createTagPresenceResponse(request, tagPresenceRuntime.service, () => tagPresenceRuntime.snapshot());
}
