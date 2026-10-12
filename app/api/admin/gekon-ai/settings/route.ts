import { z } from "zod";
import { ASSISTANT_UNAVAILABLE_MESSAGE } from "@/src/features/assistant/services/assistantAvailability";
import { requireAssistantAdmin, requireSameOrigin } from "@/src/server/assistant/assistantAdminAuth";
import { adminError, adminResponse, readAdminBody } from "@/src/server/assistant/assistantAdminHttp";
import { assistantManagementRepository } from "@/src/server/assistant/assistantManagementRepository";

export const runtime = "nodejs";
async function health(enabled: boolean): Promise<"reachable" | "unreachable" | "disabled"> {
  if (!enabled) return "disabled";
  try {
    const url = new URL(process.env.CHATBOT_SERVICE_URL || "http://127.0.0.1:8000");
    url.pathname = `${url.pathname.replace(/\/$/, "")}/health`; url.search = "";
    const response = await fetch(url, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    return response.ok ? "reachable" : "unreachable";
  } catch { return "unreachable"; }
}
export async function GET(request: Request) {
  try {
    requireAssistantAdmin(request);
    const settings = await assistantManagementRepository.settings();
    return adminResponse({ settings, health: await health(settings.enabled), unavailableMessage: ASSISTANT_UNAVAILABLE_MESSAGE });
  } catch (error) { return adminError(error); }
}
export async function PATCH(request: Request) {
  try {
    const admin = requireAssistantAdmin(request); requireSameOrigin(request);
    const body = z.object({ enabled: z.boolean(), version: z.number().int().nonnegative().max(2147483646) }).strict().parse(await readAdminBody(request));
    const settings = await assistantManagementRepository.updateSettings(body.enabled, body.version, admin);
    return adminResponse({ settings, health: await health(settings.enabled), unavailableMessage: ASSISTANT_UNAVAILABLE_MESSAGE });
  } catch (error) { return adminError(error); }
}
