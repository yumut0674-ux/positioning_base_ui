import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { logger } from "@/src/server/logger";
import { entityService, locationService } from "@/src/server/location";
import { answerLocationQuestionWithSubject } from "@/src/server/assistant/locationAnswer";
import { conversationLocationQuestion, conversationLocationSubject, modelConversationHistory } from "@/src/server/assistant/conversationContext";
import { conversationHistorySchema } from "@/src/features/assistant/services/assistantConversation";
import { ASSISTANT_UNAVAILABLE_CODE, ASSISTANT_UNAVAILABLE_MESSAGE } from "@/src/features/assistant/services/assistantAvailability";
import { assistantManagementRepository } from "@/src/server/assistant/assistantManagementRepository";
import { AssistantExecutionError, runManagedAssistantRequest } from "@/src/server/assistant/assistantRequestService";

export const runtime = "nodejs";

const DEFAULT_CHATBOT_SERVICE_URL = "http://127.0.0.1:8000";
const CHATBOT_TIMEOUT_MS = 25_000;
const CLIENT_COOKIE = "gekon_assistant_client";
const CLIENT_COOKIE_MAX_AGE_SECONDS = 30 * 60;

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
  mapId: optionalText(100).nullable(),
  sourceZoneId: optionalText(100).nullable(),
  sourceZoneName: optionalText(160).nullable(),
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
  buildingName: optionalText(160),
  floorLabel: optionalText(80),
  sourceZoneId: optionalText(100),
  sourceZoneName: optionalText(160),
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
  // Groups admin request records; conversation memory comes only from history.
  sessionId: z.string().trim().min(1).max(64).optional(),
  history: conversationHistorySchema.default([]),
  context: assistantContextSchema.optional(),
}).strict();

const assistantResponseSchema = z.object({
  data: z.object({
    sessionId: z.string().min(1),
    answer: z.string().min(1).max(32_000),
  }),
  meta: z.object({
    provider: z.literal("gemini"),
    model: z.string().min(1),
  }),
});

function chatbotServiceUrl(path: string): URL {
  const base = new URL(process.env.CHATBOT_SERVICE_URL || DEFAULT_CHATBOT_SERVICE_URL);
  base.pathname = `${base.pathname.replace(/\/$/, "")}${path}`;
  base.search = "";
  return base;
}

type ClientNamespace = { readonly id: string; readonly setCookie?: string };

function clientNamespace(request: Request): ClientNamespace {
  const cookie = request.headers.get("cookie") ?? "";
  const found = cookie.match(new RegExp(`(?:^|;\\s*)${CLIENT_COOKIE}=([a-f0-9-]{36})(?:;|$)`, "i"));
  if (found?.[1]) return { id: found[1] };
  const id = randomUUID();
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return {
    id,
    setCookie: `${CLIENT_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${CLIENT_COOKIE_MAX_AGE_SECONDS}${secure}`,
  };
}

function withClientCookie(response: NextResponse, namespace: ClientNamespace): NextResponse {
  if (namespace.setCookie) response.headers.set("Set-Cookie", namespace.setCookie);
  return response;
}

function minimizedContext(context: z.infer<typeof assistantRequestSchema>["context"]): Pick<z.infer<typeof assistantContextSchema>, "mode"> | undefined {
  // Until the app has a verified identity/role integration, do not send tag,
  // entity, map, coordinate or history data to an external model provider.
  return context?.mode ? { mode: context.mode } : undefined;
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

function upstreamUnavailable(sessionId?: string) {
  return NextResponse.json({
    error: ASSISTANT_UNAVAILABLE_MESSAGE,
    code: ASSISTANT_UNAVAILABLE_CODE,
    ...(sessionId ? { data: { sessionId, answer: ASSISTANT_UNAVAILABLE_MESSAGE } } : {}),
    meta: { availability: "unavailable" },
  }, { status: 503, headers: { "Cache-Control": "no-store" } });
}

function upstreamExecutionError(status: number, payload?: unknown) {
  const detail = payload && typeof payload === "object" && "detail" in payload
    ? (payload as { detail: unknown }).detail
    : null;
  if (status === 502 && typeof detail === "string" && detail.startsWith("Gemini API kotası aşıldı.")) {
    return new AssistantExecutionError("PROVIDER_QUOTA_EXCEEDED", "AI servisinin kullanım kotası aşıldı.", status);
  }
  return new AssistantExecutionError("UPSTREAM_REJECTED", "AI servisi isteği tamamlayamadı.", status);
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

  const namespace = clientNamespace(request);
  const publicSessionId = parsed.data.sessionId ?? randomUUID();
  const internalSessionId = `${namespace.id}:${publicSessionId}`;

  const locationQuestion = conversationLocationQuestion(parsed.data.message, parsed.data.history);
  const provider = locationQuestion ? "local" : "gemini";
  const result = await runManagedAssistantRequest({
    id: randomUUID(),
    sessionKey: createHash("sha256").update(internalSessionId).digest("hex").slice(0, 24),
    question: parsed.data.message,
    mode: parsed.data.context?.mode,
  }, provider, assistantManagementRepository, async () => {
    if (locationQuestion) {
      try {
        const subject = conversationLocationSubject(parsed.data.message, locationQuestion, parsed.data.context?.tagCode, parsed.data.history);
        const answer = await answerLocationQuestionWithSubject({ ...locationQuestion, subject: subject ?? null }, undefined, {
          search: (query, limit) => entityService.search(query, limit),
          current: (entityId) => locationService.current(entityId),
          lastKnownRoom: (entityId) => locationService.lastKnownRoom(entityId),
        });
        return { ...answer, model: "verified-location" };
      } catch { throw new AssistantExecutionError("LOCATION_SERVICE_ERROR", "Konum verisine ulaşılamadı."); }
    }
    let response: Response;
    try {
      response = await fetchWithTimeout(chatbotServiceUrl("/chat"), {
        method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          message: parsed.data.message,
          sessionId: internalSessionId,
          history: modelConversationHistory(parsed.data.history),
          context: minimizedContext(parsed.data.context),
        }),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new AssistantExecutionError("UPSTREAM_TIMEOUT", "AI servisi zaman aşımına uğradı.");
      throw new AssistantExecutionError("UPSTREAM_CONNECTION_ERROR", "AI servisine bağlantı kurulamadı.");
    }
    const payload = await readJson(response);
    if (!response.ok) throw upstreamExecutionError(response.status, payload);
    const safePayload = assistantResponseSchema.safeParse(payload);
    if (!safePayload.success) throw new AssistantExecutionError("INVALID_UPSTREAM_RESPONSE", "AI servisi geçerli bir cevap döndürmedi.");
    return { answer: safePayload.data.data.answer, model: safePayload.data.meta.model };
  });
  if (!result.available) return withClientCookie(upstreamUnavailable(publicSessionId), namespace);
  return withClientCookie(NextResponse.json({
    data: { sessionId: publicSessionId, answer: result.answer, ...(result.locationSubject ? { locationSubject: result.locationSubject } : {}) },
    meta: { provider: result.provider, model: result.model, availability: "available" },
  }, { headers: { "Cache-Control": "no-store" } }), namespace);
}

export async function DELETE(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim();
  if (!sessionId) {
    return NextResponse.json({ error: "Oturum kimliği gerekli." }, { status: 400 });
  }

  if (sessionId.length > 64) {
    return NextResponse.json({ error: "Oturum kimliği geçersiz." }, { status: 400 });
  }
  const namespace = clientNamespace(request);
  const internalSessionId = `${namespace.id}:${sessionId}`;
  try {
    if (!(await assistantManagementRepository.settings()).enabled) return withClientCookie(new NextResponse(null, { status: 204 }), namespace);
    const response = await fetchWithTimeout(chatbotServiceUrl(`/chat/${encodeURIComponent(internalSessionId)}`), {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return upstreamUnavailable();
    return withClientCookie(new NextResponse(null, { status: 204 }), namespace);
  } catch (error) {
    logger.error("assistant.session_delete_failed", error, { sessionId });
    return upstreamUnavailable();
  }
}
