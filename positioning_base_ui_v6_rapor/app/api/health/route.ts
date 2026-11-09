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
    } as const;
  } finally {
    clearTimeout(timeout);
  }
}

type HealthComponent = Readonly<{ ok: boolean; status: string; [key: string]: unknown }>;

export interface HealthDependencies {
  readonly checkDatabase: () => Promise<HealthComponent>;
  readonly checkAssistant: () => Promise<HealthComponent>;
  readonly trackingStatus: () => HealthComponent;
  readonly engineStatus: () => ReturnType<typeof regionEngineController.status>;
  readonly now: () => Date;
}

function publicComponent(component: HealthComponent): HealthComponent {
  const privateKeys = new Set(["error", "message", "stack", "host", "url"]);
  return Object.fromEntries(
    Object.entries(component).filter(([key]) => !privateKeys.has(key)),
  ) as HealthComponent;
}

export async function createHealthResponse(
  dependencies: Partial<HealthDependencies> = {},
): Promise<NextResponse> {
  const [databaseResult, assistantResult] = await Promise.all([
    (dependencies.checkDatabase ?? databaseHealth)(),
    (dependencies.checkAssistant ?? assistantHealth)(),
  ]);
  const database = publicComponent(databaseResult);
  const assistantService = publicComponent(assistantResult);
  const trackingIngest = publicComponent(
    (dependencies.trackingStatus ?? (() => trackingBuffer.status()))() as HealthComponent,
  );
  const engine = (dependencies.engineStatus ?? (() => regionEngineController.status()))();
  const regionEngine = {
    ok: true,
    status: engine.enabled ? "enabled" : "disabled",
    ...engine,
  } as const;
  const ok = database.ok && trackingIngest.ok && regionEngine.ok;

  return NextResponse.json({
    ok,
    database,
    trackingIngest,
    regionEngine,
    assistantService,
    timestamp: (dependencies.now ?? (() => new Date()))().toISOString(),
  }, {
    status: ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(): Promise<NextResponse> {
  return createHealthResponse();
}
