import { NextResponse } from "next/server";
import { logger } from "@/src/server/logger";
import { queryPostgres } from "@/src/server/postgresClient";
import { regionEngineController } from "@/src/server/regionEngine/controller";
import { trackingBuffer } from "@/src/server/trackingBuffer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASSISTANT_HEALTH_TIMEOUT_MS = 1_500;

async function databaseHealth() {
  const startedAt = Date.now();
  try {
    await queryPostgres("SELECT 1 AS health_check;");
    return { ok: true, status: "connected", latencyMs: Date.now() - startedAt } as const;
  } catch (error) {
    logger.error("health.database_failed", error);
    return {
      ok: false,
      status: "unavailable",
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    } as const;
  }
}

async function assistantHealth() {
  const configuredUrl = process.env.CHATBOT_SERVICE_URL?.trim();
  if (!configuredUrl) return { ok: false, status: "not_configured" } as const;

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ASSISTANT_HEALTH_TIMEOUT_MS);
  try {
    const url = new URL(configuredUrl);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/health`;
    url.search = "";
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal });
    return {
      ok: response.ok,
      status: response.ok ? "available" : "unavailable",
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
    } as const;
  } catch (error) {
    logger.error("health.assistant_failed", error);
    return {
      ok: false,
      status: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "unavailable",
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    } as const;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const [database, assistantService] = await Promise.all([databaseHealth(), assistantHealth()]);
  const trackingIngest = trackingBuffer.status();
  const engine = regionEngineController.status();
  const regionEngine = {
    ok: true,
    status: engine.enabled ? "enabled" : "disabled",
    ...engine,
  } as const;
  const ok = database.ok && trackingIngest.ok && regionEngine.ok && assistantService.ok;

  return NextResponse.json({
    ok,
    database,
    trackingIngest,
    regionEngine,
    assistantService,
    timestamp: new Date().toISOString(),
  }, {
    status: ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
