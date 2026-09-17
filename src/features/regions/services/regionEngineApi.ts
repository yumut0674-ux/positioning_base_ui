import type { RegionsConfig } from "../types/region.types";

export interface RegionEngineStatusResponse {
  readonly warnings?: readonly string[];
  readonly enabled: boolean;
  readonly rawPort: number;
  readonly processedPort: number;
  readonly activeVehicleCount: number;
  readonly vehiclesInRegions: number;
  readonly configLoaded: boolean;
  readonly configVersion?: string;
  readonly diagnostics?: readonly {
    readonly vehicleId: string; readonly state: string; readonly activeRegionId: string | null; readonly candidateRegionId: string | null;
    readonly doorId: string | null; readonly doorDirection: "entry" | "exit" | null; readonly doorEvidenceMode: string | null;
    readonly collectedDurationMs: number; readonly requiredDurationMs: number; readonly collectedMeasurements: number; readonly requiredMeasurements: number;
    readonly lastMeasurementQuality: number | null; readonly doorEvidenceRemainingMs: number | null;
    readonly score: { readonly base: number; readonly duration: number; readonly measurements: number; readonly door: number; readonly total: number };
    readonly reasons: readonly string[];
  }[];
}

export const REGION_ENGINE_STATUS_CHANGED_EVENT = "region-engine-status-changed";

export async function fetchRegionEngineStatus(): Promise<RegionEngineStatusResponse> {
  const response = await fetch("/api/region-engine/status", { cache: "no-store" });
  if (!response.ok) throw new Error("Region engine durumu alınamadı");
  return response.json() as Promise<RegionEngineStatusResponse>;
}

export async function updateRegionEngineStatus(enabled: boolean): Promise<RegionEngineStatusResponse> {
  const response = await fetch("/api/region-engine/status", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  const payload = await response.json() as RegionEngineStatusResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Region engine durumu değiştirilemedi");
  return payload;
}

export async function reloadRegionEngineConfig(config: RegionsConfig): Promise<void> {
  const response = await fetch("/api/region-engine/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const payload = await response.json() as { error?: string };
    throw new Error(payload.error || "Region config yeniden yüklenemedi");
  }
}

export function processedStreamUrl(): string {
  return "/api/tracking/processed";
}
