import { NextResponse } from "next/server";
import { queryPostgres } from "@/src/server/postgresClient";
import { trackingBuffer } from "@/src/server/trackingBuffer";

export const runtime = "nodejs";

type TagInput = { id: string; displayName?: string | null; status?: string | null; areaExitNotificationEnabled?: boolean };

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
ALTER TABLE tags ADD COLUMN IF NOT EXISTS area_exit_notification_enabled BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE tags SET display_name = COALESCE(display_name, tag_name, tag_code) WHERE display_name IS NULL;
`;

const selectTagsSql = `
SELECT tag_code AS id, COALESCE(display_name, tag_name, tag_code) AS "displayName", status,
  created_at AS "createdAt", area_exit_notification_enabled AS "areaExitNotificationEnabled"
FROM tags ORDER BY tag_code;`;

function cleanTag(input: TagInput): TagInput {
  const id = input.id?.trim().toUpperCase();
  if (!id || id.length > 100) throw new Error("Tag ID is required and must be 100 characters or fewer");
  if (input.areaExitNotificationEnabled !== undefined && typeof input.areaExitNotificationEnabled !== "boolean") throw new Error("Boolean notification setting is required");
  return { id, displayName: input.displayName?.trim().slice(0, 150) || null, status: input.status?.trim().slice(0, 30) || "active", areaExitNotificationEnabled: input.areaExitNotificationEnabled };
}

function upsertSql(tags: readonly TagInput[]) {
  if (!tags.length) throw new Error("No tags provided");
  const values = tags.map((input) => {
    const tag = cleanTag(input);
    const name = tag.displayName ?? tag.id;
    return `(${sqlString(tag.id)}, ${nullableString(name)}, ${nullableString(name)}, ${sqlString(tag.status ?? "active")}, ${tag.areaExitNotificationEnabled === undefined ? "NULL" : tag.areaExitNotificationEnabled ? "TRUE" : "FALSE"})`;
  }).join(",\n");
  return `WITH input(tag_code,tag_name,display_name,status,notification_enabled) AS (VALUES ${values})
INSERT INTO tags (tag_code, tag_name, display_name, status, area_exit_notification_enabled)
SELECT tag_code,tag_name,display_name,status,COALESCE(notification_enabled::boolean,TRUE) FROM input
ON CONFLICT (tag_code) DO UPDATE SET
  tag_name = EXCLUDED.tag_name, display_name = EXCLUDED.display_name, status = EXCLUDED.status,
  area_exit_notification_enabled = COALESCE((SELECT notification_enabled::boolean FROM input WHERE input.tag_code=EXCLUDED.tag_code),tags.area_exit_notification_enabled), updated_at = NOW();`;
}

function toTag(row: Record<string, string | null>) {
  return { id: row.id ?? "", displayName: row.displayName ?? row.id ?? "", status: row.status ?? "active", createdAt: row.createdAt ?? "", areaExitNotificationEnabled: row.areaExitNotificationEnabled !== "f" && row.areaExitNotificationEnabled !== "false" };
}

async function getTags() {
  const rows = await queryPostgres(`${schemaSql}${selectTagsSql}`);
  return rows.map(toTag);
}

function errorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: message.includes("required") || message.includes("provided") ? 400 : 500 });
}

export async function GET() {
  try {
    const tags = await getTags();
    trackingBuffer.invalidateRegisteredTagCache();
    return NextResponse.json({ tags });
  }
  catch (error) { return errorResponse(error, "Tag database query failed"); }
}

async function save(request: Request) {
  const body = (await request.json()) as { tags?: TagInput[] } | TagInput[] | TagInput;
  const tags: TagInput[] = Array.isArray(body)
    ? body
    : "tags" in body
      ? body.tags ?? []
      : [body as TagInput];
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
