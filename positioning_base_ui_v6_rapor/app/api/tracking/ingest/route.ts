import { NextResponse } from "next/server";
import { trackingBuffer, type TrackingPosition } from "@/src/server/trackingBuffer";
import { zoneMapResolver } from "@/src/server/maps/zoneMapResolver";
import { regionEngineController } from "@/src/server/regionEngine/controller";
import { AreaTransitionPersistenceError } from "@/src/server/regionEngine/areaTransitionRepository";
import { timingSafeEqual } from "node:crypto";
import { isPositionPdopAccepted } from "@/src/shared/tracking/pdop";
import { mapTrackingFilterSettings, TrackingFilterConfigurationError } from "@/src/server/trackingFilterSettings";

export const runtime = "nodejs";

const EXPECTED_FIELDS = ["type", "tag_id", "x", "y", "timestamp"] as const;
const OPTIONAL_FIELDS = ["quality", "pdop", "zone_id", "zone_name", "motion", "motion_label", "raw_x", "raw_y", "raw_inside", "inlier_anchor_count"] as const;
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;
const encoder = new TextEncoder();

type IngestBody = {
  readonly type?: unknown;
  readonly tag_id?: unknown;
  readonly x?: unknown;
  readonly y?: unknown;
  readonly timestamp?: unknown;
  readonly quality?: unknown;
  readonly pdop?: unknown;
  readonly zone_id?: unknown;
  readonly zone_name?: unknown;
  /** Tag IMU state from the Jetson: 0 moving, 1 stationary (other values = unknown). */
  readonly motion?: unknown;
  readonly motion_label?: unknown;
  /** Unclamped solver position and whether it was inside the Jetson zone polygon. */
  readonly raw_x?: unknown;
  readonly raw_y?: unknown;
  readonly raw_inside?: unknown;
  /** Anchors the Jetson solver kept; 3-anchor TDoA solutions can be mirrored across the corridor. */
  readonly inlier_anchor_count?: unknown;
};

function isIsoDateTime(value: string): boolean {
  const match = ISO_DATE_TIME.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offset] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offsetHour = offset === "Z" ? 0 : Number(offset.slice(1, 3));
  const offsetMinute = offset === "Z" ? 0 : Number(offset.slice(4, 6));

  return month >= 1 && month <= 12
    && day >= 1 && day <= daysInMonth
    && hour <= 23 && minute <= 59 && second <= 59
    && offsetHour <= 23 && offsetMinute <= 59
    && Number.isFinite(Date.parse(value));
}

export function parsePositionPayload(value: unknown): TrackingPosition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("İstek gövdesi tek bir JSON nesnesi olmalıdır");
  }

  const input = value as IngestBody;
  const unexpectedFields = Object.keys(input).filter(
    (field) => !EXPECTED_FIELDS.includes(field as (typeof EXPECTED_FIELDS)[number]) && !OPTIONAL_FIELDS.includes(field as (typeof OPTIONAL_FIELDS)[number]),
  );
  if (unexpectedFields.length > 0) {
    throw new Error(`Beklenmeyen alanlar: ${unexpectedFields.join(", ")}`);
  }
  const missingFields = EXPECTED_FIELDS.filter((field) => !Object.hasOwn(input, field));
  if (missingFields.length > 0) {
    throw new Error(`Eksik zorunlu alanlar: ${missingFields.join(", ")}`);
  }
  if (input.type !== "position") throw new Error('type yalnızca "position" olabilir');
  if (typeof input.tag_id !== "string" || input.tag_id.trim().length === 0) {
    throw new Error("tag_id boş olmayan bir string olmalıdır");
  }
  if (input.tag_id.trim().length > 100) throw new Error("tag_id en fazla 100 karakter olabilir");
  if (typeof input.x !== "number" || !Number.isFinite(input.x)) throw new Error("x sonlu bir number olmalıdır");
  if (typeof input.y !== "number" || !Number.isFinite(input.y)) throw new Error("y sonlu bir number olmalıdır");
  if (typeof input.timestamp !== "string" || !isIsoDateTime(input.timestamp)) {
    throw new Error("timestamp geçerli, zaman dilimi içeren bir ISO-8601 tarih/zaman değeri olmalıdır");
  }
  const sourceZoneId = normalizeNullableString(input.zone_id, "zone_id", 100);
  const sourceZoneName = normalizeNullableString(input.zone_name, "zone_name", 160);

  return {
    ...(input.quality === undefined ? {} : { quality: validateQuality(input.quality) }),
    tagCode: input.tag_id.trim().toUpperCase(),
    x: input.x,
    y: input.y,
    pdop: validatePdop(input.pdop),
    ...motionField(input.motion, input.motion_label),
    ...solverRawField(input.raw_x, input.raw_y, input.raw_inside),
    ...anchorCountField(input.inlier_anchor_count),
    timestamp: input.timestamp,
    sourceZoneId,
    sourceZoneName,
    // Numeric firmware flag wins; otherwise the label (validated strictly, as before).
    motionLabel: motionField(input.motion, undefined).motion ?? validateMotionLabel(input.motion_label),
    mapId: null,
  };
}

export function parseSourceHealthPayload(value: unknown, now = Date.now()): { zoneId: string; healthy: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Kaynak sağlık bildirimi nesne olmalıdır");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(field => !["type", "zone_id", "status", "timestamp"].includes(field)) ||
      body.type !== "source_health" || typeof body.zone_id !== "string" || !body.zone_id.trim() || body.zone_id.length > 100 ||
      !["healthy", "outage"].includes(String(body.status)) || typeof body.timestamp !== "string" || !isIsoDateTime(body.timestamp))
    throw new Error("Geçersiz kaynak sağlık bildirimi");
  const at = Date.parse(body.timestamp);
  if (now - at > 15_000 || at > now + 2_000) throw new Error("Kaynak sağlık bildirimi güncel değil");
  return { zoneId: body.zone_id.trim(), healthy: body.status === "healthy" };
}

function validHealthToken(supplied: string | null): boolean {
  const configured = process.env.TRACKING_HEALTH_TOKEN;
  if (!configured || !supplied) return false;
  const expected = Buffer.from(configured), actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function normalizeNullableString(value: unknown, field: string, maxLength: number): string | null {
  // Expand/migrate phase: omitted legacy keys are accepted exactly like explicit null.
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${field} string veya null olmalıdır`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${field} en fazla ${maxLength} karakter olabilir`);
  return normalized || null;
}

function validateQuality(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error("quality 0-1 aralığında olmalıdır");
  return value;
}

/**
 * Jetson sends `motion` as 0 (moving) / 1 (stationary) and optionally `motion_label`.
 * Unknown firmware states (e.g. 2 or "unknown") are accepted as unknown so that a new
 * firmware value never makes the whole position packet fail.
 */
function motionField(motion: unknown, label: unknown): { motion?: "moving" | "stationary" | null } {
  // Without the numeric flag the label alone travels as motionLabel (see parsePositionPayload).
  if (motion === undefined) return {};
  if (motion !== undefined && motion !== null && typeof motion !== "number" && typeof motion !== "string") throw new Error("motion number, string veya null olmalıdır");
  if (label !== undefined && label !== null && typeof label !== "string") throw new Error("motion_label string veya null olmalıdır");
  const fromValue = motion === 0 || motion === "0" || motion === "moving" ? "moving" : motion === 1 || motion === "1" || motion === "stationary" ? "stationary" : null;
  const fromLabel = label === "moving" || label === "stationary" ? label : null;
  // The numeric flag is the firmware's own value; the label is only a fallback.
  return { motion: fromValue ?? fromLabel };
}

function anchorCountField(value: unknown): { anchorCount?: number | null } {
  if (value === undefined) return {};
  if (value === null) return { anchorCount: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 64) throw new Error("inlier_anchor_count 0-64 arası tam sayı veya null olmalıdır");
  return { anchorCount: value };
}

/** Only a clamped solution (raw_inside=false) carries extra information; otherwise raw equals x/y. */
function solverRawField(rawX: unknown, rawY: unknown, rawInside: unknown): { solverRaw?: { x: number; y: number } | null } {
  if (rawX === undefined && rawY === undefined && rawInside === undefined) return {};
  if (rawInside !== undefined && rawInside !== null && typeof rawInside !== "boolean") throw new Error("raw_inside boolean veya null olmalıdır");
  for (const [name, value] of [["raw_x", rawX], ["raw_y", rawY]] as const)
    if (value !== undefined && value !== null && typeof value !== "number") throw new Error(`${name} number veya null olmalıdır`);
  const finite = typeof rawX === "number" && Number.isFinite(rawX) && typeof rawY === "number" && Number.isFinite(rawY);
  return { solverRaw: rawInside === false && finite ? { x: rawX, y: rawY } : null };
}

function validateMotionLabel(value: unknown): NonNullable<TrackingPosition["motionLabel"]> {
  if (value === undefined) return "unknown";
  if (value !== "moving" && value !== "stationary" && value !== "unknown") {
    throw new Error('motion_label "moving", "stationary" veya "unknown" olmalıdır');
  }
  return value;
}

function validatePdop(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("pdop sonlu bir number veya null olmalıdır");
  return value;
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
    if (contentType !== "application/json") {
      throw new Error("Content-Type application/json olmalıdır");
    }
    const payload = await request.json() as unknown;
    if (payload && typeof payload === "object" && (payload as { type?: unknown }).type === "source_health") {
      if (!validHealthToken(request.headers.get("x-tracking-health-token")))
        return NextResponse.json({ error: "Kaynak sağlık tokenı yapılandırılmamış veya geçersiz" }, { status: 401 });
      const signal = parseSourceHealthPayload(payload);
      const resolution = await zoneMapResolver.resolve(signal.zoneId);
      if (!resolution.mapId) return NextResponse.json({ error: "Kaynak bölgesi bir haritaya bağlı değil" }, { status: 400 });
      regionEngineController.noteSourceHealth(resolution.mapId, signal.zoneId, signal.healthy);
      return NextResponse.json({ accepted: 1, mapId: resolution.mapId, sourceHealth: signal.healthy ? "healthy" : "outage" }, { status: 202 });
    }
    const parsed = parsePositionPayload(payload);
    const resolution = await zoneMapResolver.resolve(parsed.sourceZoneId ?? null);
    // Resolve the source map first; discard poor geometry before events, inference or history.
    if (!isPositionPdopAccepted(parsed.pdop, await mapTrackingFilterSettings.read(resolution.mapId))) return new Response(null, { status: 204 });
    const position = { ...parsed, mapId: resolution.mapId };
    await trackingBuffer.ingest(position);
    return new Response(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Geçersiz konum verisi" },
      { status: error instanceof AreaTransitionPersistenceError || error instanceof TrackingFilterConfigurationError ? 503 : 400 });
  }
}

function eventMessage(position: TrackingPosition): Uint8Array {
  return encoder.encode(`event: position\ndata: ${JSON.stringify(position)}\n\n`);
}

export function GET(request: Request): Response {
  let cleanup: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const publish = (position: TrackingPosition) => controller.enqueue(eventMessage(position));
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(": keep-alive\n\n")), 15_000);
      const close = () => {
        clearInterval(heartbeat);
        trackingBuffer.off("position", publish);
        try { controller.close(); } catch { /* Client connection already closed. */ }
      };
      cleanup = close;
      trackingBuffer.on("position", publish);
      request.signal.addEventListener("abort", close, { once: true });
      controller.enqueue(encoder.encode("retry: 3000\n\n"));
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
