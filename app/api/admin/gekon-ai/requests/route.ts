import { requireAssistantAdmin } from "@/src/server/assistant/assistantAdminAuth";
import { adminError, adminResponse, parseRequestFilters } from "@/src/server/assistant/assistantAdminHttp";
import { assistantManagementRepository } from "@/src/server/assistant/assistantManagementRepository";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    requireAssistantAdmin(request);
    return adminResponse(await assistantManagementRepository.list(parseRequestFilters(new URL(request.url).searchParams)));
  } catch (error) { return adminError(error); }
}
