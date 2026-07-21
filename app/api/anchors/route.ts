import { NextResponse } from "next/server";
import { DEFAULT_ANCHORS } from "@/src/features/map/config/mapConfig";
import type { AnchorDefinition } from "@/src/features/map/types/map.types";
import { queryPostgres } from "@/src/server/postgresClient";

export const runtime = "nodejs";
type AnchorInput = AnchorDefinition;

function sqlString(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
function sqlNullableString(value: string | null | undefined): string { return typeof value === "string" && value.trim() ? sqlString(value.trim()) : "NULL"; }
function sqlNumber(value: number | null | undefined): string { return typeof value === "number" && Number.isFinite(value) ? String(value) : "NULL"; }
function sqlInteger(value: number | null | undefined): string { return typeof value === "number" && Number.isInteger(value) ? String(value) : "NULL"; }

function cleanAnchor(input: AnchorInput): AnchorInput {
  const id = input.id?.trim();
  if (!id || id.length > 100) throw new Error("Anchor ID is required and must be 100 characters or fewer");
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) throw new Error("X and Y coordinates must be valid numbers");
  if (input.z !== null && input.z !== undefined && !Number.isFinite(input.z)) throw new Error("Z coordinate must be a valid number");
  if (input.floorLevel !== null && input.floorLevel !== undefined && !Number.isInteger(input.floorLevel)) throw new Error("Floor level must be an integer");
  return { ...input, id, name: input.name?.trim().slice(0, 150) || null, status: input.status?.trim().slice(0, 30) || "active", note: input.note?.trim() || null, floorLevel: input.floorLevel ?? null, locationDesc: input.locationDesc?.trim().slice(0, 255) || null };
}

function anchorValues(input: AnchorInput): string {
  const anchor = cleanAnchor(input);
  return [sqlString(anchor.id), sqlNullableString(anchor.name ?? anchor.id), sqlNumber(anchor.x), sqlNumber(anchor.y), sqlNumber(anchor.z), sqlString(anchor.status ?? "active"), sqlNullableString(anchor.note), sqlInteger(anchor.floorLevel), sqlNullableString(anchor.locationDesc)].join(", ");
}

const schemaSql = `
CREATE TABLE IF NOT EXISTS anchors (
  id BIGSERIAL PRIMARY KEY, anchor_code VARCHAR(100) UNIQUE NOT NULL, anchor_name VARCHAR(150),
  x DOUBLE PRECISION NOT NULL, y DOUBLE PRECISION NOT NULL, z DOUBLE PRECISION,
  status VARCHAR(30) NOT NULL DEFAULT 'active', note TEXT, floor_level INTEGER, location_desc VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE anchors ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE anchors ADD COLUMN IF NOT EXISTS floor_level INTEGER;
ALTER TABLE anchors ADD COLUMN IF NOT EXISTS location_desc VARCHAR(255);
CREATE TABLE IF NOT EXISTS anchor_health_logs (
  id BIGSERIAL PRIMARY KEY,
  anchor_code VARCHAR(100) NOT NULL REFERENCES anchors(anchor_code) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL, message TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_anchor_health_logs_anchor_time ON anchor_health_logs (anchor_code, created_at DESC);
`;

const selectAnchorsSql = `
SELECT a.anchor_code AS id, a.anchor_name AS name, a.x, a.y, a.z,
  COALESCE((SELECT l.status FROM anchor_health_logs l WHERE l.anchor_code = a.anchor_code ORDER BY l.created_at DESC LIMIT 1), a.status) AS status,
  a.note, a.floor_level AS "floorLevel", a.location_desc AS "locationDesc"
FROM anchors a ORDER BY a.anchor_code;`;

function seedAnchorsSql(): string {
  return `INSERT INTO anchors (anchor_code, anchor_name, x, y, z, status, note, floor_level, location_desc)
VALUES ${DEFAULT_ANCHORS.map((anchor) => `(${anchorValues(anchor)})`).join(",\n")}
ON CONFLICT (anchor_code) DO NOTHING;`;
}

function upsertAnchorsSql(anchors: readonly AnchorInput[]): string {
  if (!anchors.length) throw new Error("No anchors provided");
  return `INSERT INTO anchors (anchor_code, anchor_name, x, y, z, status, note, floor_level, location_desc)
VALUES ${anchors.map((anchor) => `(${anchorValues(anchor)})`).join(",\n")}
ON CONFLICT (anchor_code) DO UPDATE SET
  anchor_name = EXCLUDED.anchor_name, x = EXCLUDED.x, y = EXCLUDED.y, z = EXCLUDED.z,
  status = EXCLUDED.status, note = EXCLUDED.note, floor_level = EXCLUDED.floor_level,
  location_desc = EXCLUDED.location_desc, updated_at = NOW();`;
}

function toAnchor(row: Record<string, string | null>): AnchorDefinition {
  return { id: row.id ?? "", name: row.name, x: Number(row.x), y: Number(row.y), z: row.z === null ? null : Number(row.z), status: row.status ?? "active", note: row.note, floorLevel: row.floorLevel === null ? null : Number(row.floorLevel), locationDesc: row.locationDesc };
}

async function getAnchors(seed = false) {
  const rows = await queryPostgres(`${schemaSql}${seed ? seedAnchorsSql() : ""}${selectAnchorsSql}`);
  return rows.map(toAnchor);
}

function errorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: message.includes("required") || message.includes("valid") || message.includes("provided") ? 400 : 500 });
}

export async function GET() {
  try { return NextResponse.json({ anchors: await getAnchors(true) }); }
  catch (error) { return errorResponse(error, "Anchor database query failed"); }
}

async function save(request: Request) {
  const body = (await request.json()) as { anchors?: AnchorInput[] } | AnchorInput[] | AnchorInput;
  const anchors = Array.isArray(body) ? body : "anchors" in body ? body.anchors : [body];
  if (!anchors?.length) throw new Error("No anchors provided");
  await queryPostgres(`${schemaSql}${upsertAnchorsSql(anchors)}`);
  return getAnchors();
}

export async function POST(request: Request) {
  try { return NextResponse.json({ anchors: await save(request) }); }
  catch (error) { return errorResponse(error, "Anchor save failed"); }
}
export async function PUT(request: Request) {
  try { return NextResponse.json({ anchors: await save(request) }); }
  catch (error) { return errorResponse(error, "Anchor update failed"); }
}
export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return NextResponse.json({ error: "Anchor ID is required" }, { status: 400 });
    await queryPostgres(`${schemaSql}DELETE FROM anchors WHERE anchor_code = ${sqlString(id)};`);
    return NextResponse.json({ anchors: await getAnchors() });
  } catch (error) { return errorResponse(error, "Anchor delete failed"); }
}
