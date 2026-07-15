import { NextResponse } from "next/server";
import { queryPostgres } from "@/src/server/postgresClient";
import { trackingBuffer } from "@/src/server/trackingBuffer";

export const runtime = "nodejs";

type TagInput = { id: string; displayName?: string | null; status?: string | null };

function sqlString(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
function nullableString(value: string | null | undefined): string { return typeof value === "string" && value.trim() ? sqlString(value.trim()) : "NULL"; }

const schemaSql = `
CREATE TABLE IF NOT EXISTS tags (
  id BIGSERIAL PRIMARY KEY,
  tag_code VARCHAR(100) UNIQUE NOT NULL,
  tag_name VARCHAR(150),
  display_name VARCHAR(150),
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE tags ADD COLUMN IF NOT EXISTS display_name VARCHAR(150);
ALTER TABLE tags ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE tags SET display_name = COALESCE(display_name, tag_name, tag_code) WHERE display_name IS NULL;
`;

const selectTagsSql = `
SELECT tag_code AS id, COALESCE(display_name, tag_name, tag_code) AS "displayName", status,
  created_at AS "createdAt"
FROM tags ORDER BY tag_code;`;

const seedSql = `
INSERT INTO tags (tag_code, tag_name, display_name, status) VALUES
  ('TAG-001', 'Forklift 07', 'Forklift 07', 'active'),
  ('TAG-014', 'Operator A14', 'Operator A14', 'active'),
  ('TAG-028', 'Pallet 28', 'Pallet 28', 'active')
ON CONFLICT (tag_code) DO NOTHING;`;

function cleanTag(input: TagInput): TagInput {
  const id = input.id?.trim().toUpperCase();
  if (!id || id.length > 100) throw new Error("Tag ID is required and must be 100 characters or fewer");
  return { id, displayName: input.displayName?.trim().slice(0, 150) || null, status: input.status?.trim().slice(0, 30) || "active" };
}

function upsertSql(tags: readonly TagInput[]) {
  if (!tags.length) throw new Error("No tags provided");
  const values = tags.map((input) => {
    const tag = cleanTag(input);
    const name = tag.displayName ?? tag.id;
    return `(${sqlString(tag.id)}, ${nullableString(name)}, ${nullableString(name)}, ${sqlString(tag.status ?? "active")})`;
  }).join(",\n");
  return `INSERT INTO tags (tag_code, tag_name, display_name, status) VALUES ${values}
ON CONFLICT (tag_code) DO UPDATE SET
  tag_name = EXCLUDED.tag_name, display_name = EXCLUDED.display_name, status = EXCLUDED.status, updated_at = NOW();`;
}

function toTag(row: Record<string, string | null>) {
  return { id: row.id ?? "", displayName: row.displayName ?? row.id ?? "", status: row.status ?? "active", createdAt: row.createdAt ?? "" };
}

async function getTags(seed = false) {
  const rows = await queryPostgres(`${schemaSql}${seed ? seedSql : ""}${selectTagsSql}`);
  return rows.map(toTag);
}

function errorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: message.includes("required") || message.includes("provided") ? 400 : 500 });
}

export async function GET() {
  try {
    const tags = await getTags(true);
    trackingBuffer.invalidateRegisteredTagCache();
    return NextResponse.json({ tags });
  }
  catch (error) { return errorResponse(error, "Tag database query failed"); }
}

async function save(request: Request) {
  const body = (await request.json()) as { tags?: TagInput[] } | TagInput[] | TagInput;
  const tags = Array.isArray(body) ? body : "tags" in body ? body.tags : [body];
  if (!tags?.length) throw new Error("No tags provided");
  await queryPostgres(`${schemaSql}${upsertSql(tags)}`);
  trackingBuffer.invalidateRegisteredTagCache();
  return getTags();
}

export async function POST(request: Request) {
  try { return NextResponse.json({ tags: await save(request) }); }
  catch (error) { return errorResponse(error, "Tag save failed"); }
}
export async function PUT(request: Request) {
  try { return NextResponse.json({ tags: await save(request) }); }
  catch (error) { return errorResponse(error, "Tag update failed"); }
}
export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return NextResponse.json({ error: "Tag ID is required" }, { status: 400 });
    await queryPostgres(`${schemaSql}DELETE FROM tags WHERE tag_code = ${sqlString(id)};`);
    trackingBuffer.invalidateRegisteredTagCache();
    return NextResponse.json({ tags: await getTags() });
  } catch (error) { return errorResponse(error, "Tag delete failed"); }
}
