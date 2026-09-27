export interface ReportDecision {
  readonly tagCode: string;
  readonly at: string;
  readonly mapId: string | null;
  readonly roomId: string | null;
  readonly roomName: string | null;
  readonly state: string | null;
  readonly corridorEvidence: boolean;
}

export interface ReportRow {
  readonly from: string;
  readonly to: string;
  readonly mapId: string | null;
  readonly roomId: string | null;
  readonly floor: string;
  readonly room: string;
  readonly gap: boolean;
}

export interface TagReport {
  readonly tagCode: string;
  readonly displayName: string;
  readonly rows: readonly ReportRow[];
  readonly hasRecords: boolean;
}

const GAP_MS = 5 * 60_000;

function location(decision: ReportDecision): Pick<ReportRow, "mapId" | "roomId" | "floor" | "room" | "gap"> {
  if (decision.state === "TRACKING_OUTSIDE" && decision.corridorEvidence) return { mapId: decision.mapId, roomId: null, floor: decision.mapId ?? "—", room: "Koridor", gap: false };
  if (decision.state !== "IN_REGION" || !decision.roomId) return { mapId: decision.mapId, roomId: null, floor: decision.mapId ?? "—", room: "—", gap: false };
  return { mapId: decision.mapId, roomId: decision.roomId, floor: decision.mapId ?? "—", room: decision.roomName ?? decision.roomId, gap: false };
}

function push(rows: ReportRow[], start: number, end: number, place: Pick<ReportRow, "mapId" | "roomId" | "floor" | "room" | "gap">): void {
  if (end <= start) return;
  const next: ReportRow = { from: new Date(start).toISOString(), to: new Date(end).toISOString(), ...place };
  const previous = rows.at(-1);
  if (previous && previous.to === next.from && previous.mapId === next.mapId && previous.roomId === next.roomId && previous.room === next.room && previous.gap === next.gap) {
    rows[rows.length - 1] = { ...previous, to: next.to };
  } else rows.push(next);
}

/** Intervals are credited only when two adjacent decisions are at most five minutes apart. */
export function buildTagReport(tagCode: string, displayName: string, from: string, to: string, decisions: readonly ReportDecision[]): TagReport {
  const start = Date.parse(from);
  const end = Date.parse(to);
  const ordered = [...decisions].filter(item => item.tagCode.toUpperCase() === tagCode.toUpperCase() && Number.isFinite(Date.parse(item.at)) && Date.parse(item.at) <= end)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const seed = ordered.filter(item => Date.parse(item.at) < start).at(-1);
  const within = ordered.filter(item => Date.parse(item.at) >= start);
  const rows: ReportRow[] = [];
  let cursor = start;
  let previous = seed;
  for (const current of within) {
    const at = Math.min(end, Date.parse(current.at));
    if (at > cursor) {
      if (previous && at - Date.parse(previous.at) <= GAP_MS) push(rows, cursor, at, location(previous));
      else push(rows, cursor, at, { mapId: null, roomId: null, floor: "—", room: "Veri yok", gap: true });
    }
    cursor = at;
    previous = current;
  }
  push(rows, cursor, end, { mapId: null, roomId: null, floor: "—", room: "Veri yok", gap: true });
  return { tagCode, displayName, rows, hasRecords: within.length > 0 };
}

export function filterTagReportToRoom(report: TagReport, room: { readonly mapId: string; readonly roomId: string }): TagReport {
  const rows = report.rows.filter(row => row.gap || (row.mapId === room.mapId && row.roomId === room.roomId));
  return { ...report, rows, hasRecords: rows.some(row => !row.gap) };
}
