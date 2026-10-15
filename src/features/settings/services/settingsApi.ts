import type { SystemSettings, SystemSettingsResponse } from "../types/settings.types";

async function settingsRequest(init?: RequestInit): Promise<SystemSettingsResponse> {
  const response = await fetch("/api/settings", { cache: "no-store", ...init });
  const payload = await response.json() as SystemSettingsResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Sistem ayarlarına ulaşılamadı.");
  return payload;
}
export const fetchSystemSettings = () => settingsRequest();
export const saveSystemSettings = (settings: SystemSettings) => settingsRequest({
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings),
});
