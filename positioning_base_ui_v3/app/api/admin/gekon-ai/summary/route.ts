import { requireAssistantAdmin } from "@/src/server/assistant/assistantAdminAuth";
import { adminError, adminResponse, parseDateRange } from "@/src/server/assistant/assistantAdminHttp";
import { assistantManagementRepository } from "@/src/server/assistant/assistantManagementRepository";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    requireAssistantAdmin(request);
    const { from, to } = parseDateRange(new URL(request.url).searchParams);
    return adminResponse(await assistantManagementRepository.summary(from, to));
  } catch (error) { return adminError(error); }
}
