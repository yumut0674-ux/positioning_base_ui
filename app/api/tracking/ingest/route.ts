import { NextResponse } from "next/server";
import { trackingBuffer, type TrackingPosition } from "@/src/server/trackingBuffer";

export const runtime = "nodejs";

type IngestBody = {
  readonly tagCode?: unknown;
  readonly tag_code?: unknown;
  readonly id?: unknown;
  readonly x?: unknown;
  readonly y?: unknown;
  readonly battery?: unknown;
  readonly createdAt?: unknown;
  readonly positions?: unknown;
};

function asFiniteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function toPosition(value: unknown): TrackingPosition {
  if (!value || typeof value !== "object") throw new Error("Her konum kaydı bir nesne olmalıdır");
  const input = value as IngestBody;
  const tagCode = String(input.tagCode ?? input.tag_code ?? input.id ?? "").trim().toUpperCase();
  const x = asFiniteNumber(input.x);
  const y = asFiniteNumber(input.y);
  const battery = input.battery === undefined || input.battery === null ? null : asFiniteNumber(input.battery);
  if (!tagCode || tagCode.length > 100) throw new Error("Geçerli bir tagCode gereklidir");
  if (x === null || y === null) throw new Error("x ve y sayısal olmalıdır");
  if (input.battery !== undefined && input.battery !== null && battery === null) throw new Error("battery sayısal olmalıdır");
  const suppliedDate = typeof input.createdAt === "string" ? Date.parse(input.createdAt) : NaN;
  return { tagCode, x, y, battery, createdAt: Number.isFinite(suppliedDate) ? new Date(suppliedDate).toISOString() : new Date().toISOString() };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as IngestBody;
    const rawPositions = Array.isArray(body) ? body : Array.isArray(body.positions) ? body.positions : [body];
    const positions = rawPositions.map(toPosition);
    const persisted = await Promise.all(positions.map((position) => trackingBuffer.ingest(position)));
    return NextResponse.json({ accepted: positions.length, buffered: persisted.filter(Boolean).length }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Geçersiz konum verisi" }, { status: 400 });
  }
}
