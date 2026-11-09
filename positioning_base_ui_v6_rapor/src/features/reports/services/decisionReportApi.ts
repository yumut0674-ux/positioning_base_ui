import type { DecisionReportRequest } from "../types/decisionReport.types";

export async function downloadDecisionReport(input: DecisionReportRequest): Promise<number> {
  const response = await fetch("/api/reports/motor-decisions", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "Yönetici raporu indirilemedi.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const date = new Date(Date.parse(input.from) + 3 * 3_600_000).toISOString().slice(0, 10);
  link.download = `yonetici-motor-kararlari-${date}.${input.format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return Number(response.headers.get("X-Decision-Count") ?? 0);
}
