import { z } from "zod";
import { requireAssistantAdmin } from "@/src/server/assistant/assistantAdminAuth";
import { adminError, adminResponse } from "@/src/server/assistant/assistantAdminHttp";
import { assistantManagementRepository } from "@/src/server/assistant/assistantManagementRepository";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireAssistantAdmin(request);
    const id = z.string().uuid().parse((await context.params).id);
    return adminResponse(await assistantManagementRepository.detail(id));
  } catch (error) { return adminError(error); }
}
