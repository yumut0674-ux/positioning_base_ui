import { z } from "zod";
import { roomTestRepository } from "@/src/server/roomTests/roomTestRepository";
import { requireAdmin, testError, testResponse } from "@/src/server/roomTests/roomTestHttp";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    requireAdmin(request); const { id } = await context.params;
    z.string().regex(/^test-[a-zA-Z0-9-]{1,80}$/).parse(id);
    return testResponse({ session: await roomTestRepository.get(id) });
  } catch (error) { return testError(error); }
}
