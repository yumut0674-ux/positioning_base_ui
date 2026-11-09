export const REQUEST_STATUSES = ["pending", "success", "error", "disabled", "interrupted"] as const;
export type AssistantRequestStatus = typeof REQUEST_STATUSES[number];
export type AssistantProvider = "local" | "gemini";
export const STATUS_LABELS: Record<AssistantRequestStatus, string> = {
  pending: "İşleniyor", success: "Başarılı", error: "Hata", disabled: "Kullanım dışı", interrupted: "Yarıda kaldı",
};
export interface AssistantSettings {
  enabled: boolean;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
  recordingStartedAt: string;
}
export interface AssistantRequestRecord {
  id: string;
  sessionKey: string;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  question: string;
  answer: string | null;
  status: AssistantRequestStatus;
  provider: AssistantProvider | null;
  model: string | null;
  mode: "live" | "history" | null;
  errorCode: string | null;
  errorSummary: string | null;
  upstreamStatus: number | null;
  providerAttempted: boolean;
}
export type AssistantRequestListItem = Omit<AssistantRequestRecord, "answer" | "errorSummary">;
export interface AssistantCounts {
  total: number; success: number; error: number; disabled: number; pending: number; interrupted: number;
}
export interface AssistantSummary {
  today: AssistantCounts;
  totals: AssistantCounts;
  days: (AssistantCounts & { date: string })[];
  from: string;
  to: string;
}
export interface AssistantRequestFilters {
  from: string; to: string; status: string; provider: string; search: string; page: number;
}
export interface AssistantRequestPage {
  items: AssistantRequestListItem[]; total: number; page: number; pageSize: number;
}
export interface AssistantAdminSettingsResponse {
  settings: AssistantSettings;
  health: "reachable" | "unreachable" | "disabled";
  unavailableMessage: string;
}
export function istanbulDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
