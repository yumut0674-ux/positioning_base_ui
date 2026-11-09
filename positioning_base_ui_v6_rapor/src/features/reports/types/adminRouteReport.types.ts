import type { DecisionReportRequest } from "./decisionReport.types";

export type AdminRouteReportRequest = DecisionReportRequest;
export type AdminRouteKind = "room" | "corridor" | "uncertain" | "outside" | "gap";

export interface AdminRouteReportRow {
  readonly tagCode: string;
  readonly tagName: string;
  readonly from: string;
  readonly to: string;
  readonly durationMs: number;
  readonly mapId: string;
  readonly mapName: string;
  readonly roomId: string;
  readonly location: string;
  readonly kind: AdminRouteKind;
  readonly candidateRoomId: string;
  readonly measurementKinds: readonly string[];
}

export interface AdminRouteReportData {
  readonly from: string;
  readonly to: string;
  readonly generatedAt: string;
  readonly timezone: "Europe/Istanbul";
  readonly filters: { readonly tagCode?: string; readonly mapId?: string; readonly regionId?: string };
  readonly rows: readonly AdminRouteReportRow[];
}
