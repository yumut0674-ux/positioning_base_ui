import { NextResponse } from "next/server";
import { trackingBuffer, type TrackingPosition } from "@/src/server/trackingBuffer";

export const runtime = "nodejs";

const EXPECTED_FIELDS = ["type", "tag_id", "x", "y", "timestamp"] as const;
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;
const encoder = new TextEncoder();

type IngestBody = {
  readonly type?: unknown;
  readonly tag_id?: unknown;
  readonly x?: unknown;
  readonly y?: unknown;
  readonly timestamp?: unknown;
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
    (field) => !EXPECTED_FIELDS.includes(field as (typeof EXPECTED_FIELDS)[number]),
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

  return {
    tagCode: input.tag_id.trim().toUpperCase(),
    x: input.x,
    y: input.y,
    timestamp: input.timestamp,
  };
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
    if (contentType !== "application/json") {
      throw new Error("Content-Type application/json olmalıdır");
    }
    const position = parsePositionPayload(await request.json());
    const buffered = await trackingBuffer.ingest(position);
    return NextResponse.json({ accepted: 1, buffered: buffered ? 1 : 0 }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Geçersiz konum verisi" }, { status: 400 });
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
