export type DecisionReportFormat = "pdf" | "xlsx" | "csv" | "json";

export interface DecisionReportRequest {
  readonly from: string;
  readonly to: string;
  readonly tagCode?: string;
  readonly mapId?: string;
  readonly regionId?: string;
  readonly format: DecisionReportFormat;
}

export interface DecisionReportItem {
  readonly decisionId: string;
  readonly publishedAt: string;
  readonly tagCode: string;
  readonly tagName: string;
  readonly mapId: string;
  readonly mapName: string;
  readonly previousState: string;
  readonly nextState: string;
  readonly eventType: string;
  readonly regionId: string;
  readonly regionName: string;
  readonly candidateRegionId: string;
  readonly candidateRegionName: string;
  readonly measurementKind: string;
  readonly confidence?: number;
  readonly trigger: string;
  readonly synthetic: boolean;
  readonly rawX?: number;
  readonly rawY?: number;
  readonly publishedX?: number;
  readonly publishedY?: number;
  readonly doorId: string;
  readonly doorDistanceMeters?: number;
  readonly reasonCodes: readonly string[];
  readonly reasonText: string;
  readonly engineVersion: string;
  readonly configVersion: string;
  readonly payload: Record<string, unknown>;
}

export interface DecisionReportData {
  readonly from: string;
  readonly to: string;
  readonly generatedAt: string;
  readonly timezone: "Europe/Istanbul";
  readonly filters: { readonly tagCode?: string; readonly mapId?: string; readonly regionId?: string };
  readonly items: readonly DecisionReportItem[];
}
