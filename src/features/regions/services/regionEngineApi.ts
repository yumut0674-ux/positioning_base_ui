import type { RegionsConfig } from "../types/region.types";

export interface RegionEngineStatusResponse {
  readonly areaTracking?: { readonly active: boolean; readonly pendingWrites: number; readonly queuedEvents: number; readonly queuedStates: number;
    readonly batchSize: number; readonly maxPendingEvents: number; readonly maxPendingStates: number; readonly coalescedStateWrites: number;
    readonly droppedRecords: number; readonly rejectedWrites: number; readonly error: string | null;
    readonly sourceHealth: Readonly<Record<string, "healthy" | "outage" | "unknown">>;
    readonly pendingExits: readonly { readonly tagCode: string; readonly mapId: string; readonly areaId: string; readonly gateId: string;
      readonly lastMeasuredAt: string; readonly dueAt: string; readonly sourceHealth: "healthy" | "outage" | "unknown"; readonly reason: string }[] };
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
    readonly silentDoorCandidateRegionId: string | null; readonly silentDoorCandidateDoorId: string | null;
    readonly silentDoorDistanceMeters: number | null; readonly silentDoorObservedAt: number | null;
    readonly silentDoorCandidateSource: "silent-door-proximity" | null;
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
