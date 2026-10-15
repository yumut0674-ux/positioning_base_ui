import { createSettingsHandlers } from "@/src/server/settings/settingsHttp";
import { tagPresenceRuntime } from "@/src/server/tracking/tagPresenceRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createSettingsHandlers(undefined, () => tagPresenceRuntime.refreshSettings());
export const GET = handlers.get;
export const PUT = handlers.put;
