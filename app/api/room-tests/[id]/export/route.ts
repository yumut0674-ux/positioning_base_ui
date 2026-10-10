import { z } from "zod";
import { exportSession } from "@/src/features/roomTests/services/roomTestModel";
import { roomTestRepository } from "@/src/server/roomTests/roomTestRepository";
import { requireAdmin, testError, testResponse } from "@/src/server/roomTests/roomTestHttp";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    requireAdmin(request); const { id } = await context.params, params = new URL(request.url).searchParams;
    const format = z.enum(["full", "tagged", "array", "benchmark"]).parse(params.get("format") ?? "full");
    return testResponse(exportSession(await roomTestRepository.get(id), format, params.get("scope") === "all"));
  } catch (error) { return testError(error); }
}
