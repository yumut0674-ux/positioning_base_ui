import type { AdminRouteReportRequest } from "../types/adminRouteReport.types";

export async function downloadAdminRouteReport(input: AdminRouteReportRequest): Promise<number> {
  const response = await fetch("/api/reports/admin-route-history", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "Yönetici oda ve koridor raporu indirilemedi.");
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  const date = new Date(Date.parse(input.from) + 3 * 3_600_000).toISOString().slice(0, 10);
  link.download = `yonetici-oda-koridor-${date}.${input.format}`;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return Number(response.headers.get("X-Interval-Count") ?? 0);
}
