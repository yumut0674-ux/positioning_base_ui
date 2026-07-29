import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/src/server/logger";

export const runtime = "nodejs";

const DEFAULT_CHATBOT_SERVICE_URL = "http://127.0.0.1:8000";
const CHATBOT_TIMEOUT_MS = 25_000;

const isoWithTimezoneSchema = z.string().trim().refine((value) => {
  const hasTimezone = /(Z|[+-]\d{2}:\d{2})$/i.test(value);
  return hasTimezone && Number.isFinite(Date.parse(value));
}, "ISO 8601 tarihi açık bir timezone bilgisi içermelidir");

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();
const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  observedAt: isoWithTimezoneSchema,
}).strict();
const historyPointSchema = positionSchema.extend({
  zoneName: optionalText(160),
}).strict();

const assistantContextSchema = z.object({
  mode: z.enum(["live", "history"]).optional(),
  selectedTagId: optionalText(100),
  tagCode: optionalText(100),
  entityName: optionalText(160),
  from: isoWithTimezoneSchema.optional(),
  to: isoWithTimezoneSchema.optional(),
  floorPlanId: optionalText(100),
  floorPlanName: optionalText(160),
  tagStatus: optionalText(50),
  zoneName: optionalText(160),
  livePosition: positionSchema.optional(),
  history: z.object({
    returnedCount: z.number().int().nonnegative(),
    sourcePointCount: z.number().int().nonnegative(),
    sampled: z.boolean(),
    distanceMeters: z.number().finite().nonnegative(),
  }).strict().optional(),
  historyPoints: z.array(historyPointSchema).max(200).optional(),
}).strict();

const assistantRequestSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  sessionId: z.string().trim().min(1).max(100).optional(),
  context: assistantContextSchema.optional(),
}).strict();

const assistantResponseSchema = z.object({
  data: z.object({
    sessionId: z.string().min(1),
    answer: z.string(),
  }),
  meta: z.object({
    provider: z.literal("gemini"),
    model: z.string().min(1),
  }),
});

function chatbotServiceUrl(path: string): URL {
  const base = new URL(process.env.CHATBOT_SERVICE_URL ?? DEFAULT_CHATBOT_SERVICE_URL);
  base.pathname = `${base.pathname.replace(/\/$/, "")}${path}`;
  base.search = "";
  return base;
}

function validationError(error: z.ZodError) {
  return NextResponse.json({
    error: "Gekon AI isteği doğrulanamadı.",
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  }, { status: 400 });
}

function upstreamUnavailable(status = 503) {
  return NextResponse.json({
    error: "Gekon AI bağlantısı kesildi. Lütfen yerel servisi başlatın.",
  }, { status });
}

function safeUpstreamError(status: number) {
  const responseStatus = status >= 500 ? 502 : 400;
  return NextResponse.json({
    error: "Gekon AI yanıtı tamamlanamadı. Lütfen biraz sonra tekrar deneyin.",
  }, { status: responseStatus });
}

async function fetchWithTimeout(url: URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHATBOT_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const rawBody = await request.json().catch(() => null);
  const parsed = assistantRequestSchema.safeParse(rawBody);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const response = await fetchWithTimeout(chatbotServiceUrl("/chat"), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parsed.data),
    });

    const payload = await readJson(response);
    if (!response.ok) {
      logger.error("assistant.upstream_rejected", new Error(`HTTP ${response.status}`), { status: response.status });
      return safeUpstreamError(response.status);
    }

    const safePayload = assistantResponseSchema.safeParse(payload);
    if (!safePayload.success) {
      logger.error("assistant.invalid_upstream_response", safePayload.error);
      return NextResponse.json({
        error: "Gekon AI beklenmeyen bir yanıt döndürdü.",
      }, { status: 502 });
    }

    return NextResponse.json(safePayload.data, { status: 200 });
  } catch (error) {
    logger.error("assistant.request_failed", error);
    return upstreamUnavailable();
  }
}

export async function DELETE(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim();
  if (!sessionId) {
    return NextResponse.json({ error: "Oturum kimliği gerekli." }, { status: 400 });
  }

  try {
    const response = await fetchWithTimeout(chatbotServiceUrl(`/chat/${encodeURIComponent(sessionId)}`), {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return safeUpstreamError(response.status);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logger.error("assistant.session_delete_failed", error, { sessionId });
    return upstreamUnavailable();
  }
}
