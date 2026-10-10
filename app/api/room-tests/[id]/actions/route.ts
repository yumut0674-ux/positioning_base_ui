import { z } from "zod";
import { actionSchema } from "@/src/features/roomTests/services/roomTestModel";
import { roomTestRepository } from "@/src/server/roomTests/roomTestRepository";
import { readBody, requireAdmin, testError, testResponse } from "@/src/server/roomTests/roomTestHttp";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  try {
    requireAdmin(request); const { id } = await context.params;
    const input = z.object({ action: actionSchema, expectedVersion: z.number().int().min(0) }).parse(await readBody(request));
    return testResponse({ session: await roomTestRepository.act(id, input.action, input.expectedVersion) });
  } catch (error) { return testError(error); }
}
