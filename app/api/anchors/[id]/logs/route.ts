import { NextResponse } from "next/server";
import { queryPostgres } from "@/src/server/postgresClient";

export const runtime = "nodejs";

function sqlString(value: string): string { return `'${value.replaceAll("'", "''")}'`; }

const schemaSql = `
CREATE TABLE IF NOT EXISTS anchor_health_logs (
  id BIGSERIAL PRIMARY KEY,
  anchor_code VARCHAR(100) NOT NULL REFERENCES anchors(anchor_code) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_anchor_health_logs_anchor_time ON anchor_health_logs (anchor_code, created_at DESC);
`;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const anchorId = decodeURIComponent(rawId).trim();
    if (!anchorId) return NextResponse.json({ error: "Anchor ID is required" }, { status: 400 });
    const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 100);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200) : 100;
    const rows = await queryPostgres(`${schemaSql}
SELECT id, anchor_code AS "anchorCode", status, message, created_at AS "createdAt"
FROM anchor_health_logs WHERE anchor_code = ${sqlString(anchorId)}
ORDER BY created_at DESC LIMIT ${limit};`);
    return NextResponse.json({ logs: rows.map((row) => ({
      id: row.id ?? "", anchorCode: row.anchorCode ?? anchorId, status: row.status ?? "unknown",
      message: row.message, createdAt: row.createdAt ?? "",
    })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Health log query failed" }, { status: 500 });
  }
}
