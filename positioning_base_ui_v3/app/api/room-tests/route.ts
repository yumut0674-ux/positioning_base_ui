import { z } from "zod";
import { seedSchema } from "@/src/features/roomTests/services/roomTestModel";
import { roomTestRepository } from "@/src/server/roomTests/roomTestRepository";
import { readBody, requireAdmin, testError, testResponse } from "@/src/server/roomTests/roomTestHttp";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const params = new URL(request.url).searchParams;
    const offset = z.coerce.number().int().min(0).max(100000).parse(params.get("offset") ?? 0);
    return testResponse({ ...await roomTestRepository.list(offset, (params.get("search") ?? "").slice(0, 150)), serverTime: new Date().toISOString() });
  } catch (error) { return testError(error); }
}
export async function POST(request: Request) {
  try { requireAdmin(request); return testResponse({ session: await roomTestRepository.create(seedSchema.parse(await readBody(request))) }); }
  catch (error) { return testError(error); }
}
