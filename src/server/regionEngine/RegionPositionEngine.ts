import type { TrackingPosition } from "../trackingBuffer";
import { logger } from "../logger";
import { distanceFromPolygon, pointInPolygon } from "./geometry";
import type {
  CompiledRegion, CompiledRegionsConfig, ProcessedPosition, RegionEngineStatus,
  VehicleRegionState, VehicleRegionStatus,
} from "./types";

type Publish = (position: ProcessedPosition) => void;

export class RegionPositionEngine {
  private enabled = false;
  private config: CompiledRegionsConfig | null = null;
  private readonly vehicles = new Map<string, VehicleRegionStatus>();
  private scheduler: ReturnType<typeof setInterval> | null = null;

  public constructor(
    private readonly publish: Publish,
    private readonly broadcastIntervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  public enable(config: CompiledRegionsConfig): void {
    if (this.enabled) return;
    this.config = config;
    this.vehicles.clear();
    this.enabled = true;
    this.scheduler = setInterval(() => this.runScheduler(), this.broadcastIntervalMs);
    this.scheduler.unref?.();
    this.log("REGION_ENGINE_ENABLED");
    this.log("REGION_CONFIG_LOADED", undefined, undefined, 1);
  }

  public disable(): void {
    if (!this.enabled) return;
    if (this.scheduler) clearInterval(this.scheduler);
    this.scheduler = null;
    this.enabled = false;
    this.config = null;
    this.vehicles.clear();
    this.log("REGION_ENGINE_DISABLED");
  }

  public reload(config: CompiledRegionsConfig): void {
    if (!this.enabled) {
      this.config = config;
      return;
    }
    // Config was fully compiled before this atomic reference replacement.
    this.config = config;
    const validRegions = new Set(config.regions.map((region) => region.id));
    for (const vehicle of this.vehicles.values()) {
      if (vehicle.activeRegionId && !validRegions.has(vehicle.activeRegionId)) {
        this.resetToOutside(vehicle);
        this.publishRaw(vehicle);
      }
    }
    this.log("REGION_CONFIG_LOADED", undefined, undefined, 1);
  }

  public ingest(raw: TrackingPosition): ProcessedPosition | undefined {
    if (!this.enabled || !this.config) return undefined;
    try {
      return this.process(raw);
    } catch (error) {
      logger.error("region_engine.position_failed", error, {
        vehicleId: raw.tagCode,
      });
      return undefined;
    }
  }

  public tick(): void {
    this.runScheduler();
  }

  public getStatus(rawPort: number, processedPort: number): RegionEngineStatus {
    let vehiclesInRegions = 0;
    let activeVehicleCount = 0;
    for (const vehicle of this.vehicles.values()) {
      if (vehicle.activeRegionId) vehiclesInRegions += 1;
      if (vehicle.state !== "LOCATION_LOST") activeVehicleCount += 1;
    }
    return {
      enabled: this.enabled,
      rawPort,
      processedPort,
      activeVehicleCount,
      vehiclesInRegions,
      configLoaded: this.config !== null,
    };
  }

  public getVehicleState(vehicleId: string): VehicleRegionStatus | undefined {
    return this.vehicles.get(vehicleId);
  }

  private process(raw: TrackingPosition): ProcessedPosition {
    const config = this.config!;
    const timestamp = Date.parse(raw.timestamp);
    const receivedAt = Number.isFinite(timestamp) ? timestamp : this.now();
    let vehicle = this.vehicles.get(raw.tagCode);
    if (!vehicle) {
      const resolved = this.rawPosition(raw, "TRACKING_OUTSIDE");
      vehicle = {
        vehicleId: raw.tagCode,
        state: "TRACKING_OUTSIDE",
        lastRawPosition: raw,
        resolvedPosition: resolved,
        activeRegionId: null,
        candidateRegionId: null,
        entryConfidence: 0,
        lastRawDataTimestamp: receivedAt,
        lastPublishedTimestamp: 0,
        insideConfirmationCount: 0,
        exitConfirmationCount: 0,
      };
      this.vehicles.set(raw.tagCode, vehicle);
    }
    vehicle.lastRawPosition = raw;
    vehicle.lastRawDataTimestamp = receivedAt;

    if (vehicle.activeRegionId) {
      const activeRegion = config.regions.find((region) => region.id === vehicle!.activeRegionId);
      if (!activeRegion) {
        this.resetToOutside(vehicle);
        return this.publishRaw(vehicle);
      }
      const inside = pointInPolygon(raw, activeRegion);
      const beyondExitMargin = !inside && distanceFromPolygon(raw, activeRegion) >= config.rules.exitMarginMeters;
      if (!beyondExitMargin) {
        vehicle.exitConfirmationCount = 0;
        vehicle.state = "IN_REGION";
        return this.publishCenter(vehicle, activeRegion, raw.timestamp);
      }

      vehicle.exitConfirmationCount += 1;
      vehicle.state = "EXIT_CANDIDATE";
      if (vehicle.exitConfirmationCount < config.rules.exitConfirmationCount) {
        return this.publishCenter(vehicle, activeRegion, raw.timestamp);
      }
      this.log("VEHICLE_EXITED_REGION", vehicle.vehicleId, activeRegion.id, 1);
      this.resetToOutside(vehicle);
      return this.publishRaw(vehicle);
    }

    const candidate = this.findContainingRegion(raw);
    if (!candidate) {
      this.resetToOutside(vehicle);
      return this.publishRaw(vehicle);
    }

    if (vehicle.candidateRegionId !== candidate.id) {
      vehicle.candidateRegionId = candidate.id;
      vehicle.insideConfirmationCount = 1;
      vehicle.state = "ENTRY_CANDIDATE";
      this.log("REGION_ENTRY_CANDIDATE", vehicle.vehicleId, candidate.id, 1 / config.rules.entryConfirmationCount);
    } else {
      vehicle.insideConfirmationCount += 1;
    }
    vehicle.entryConfidence = Math.min(1, vehicle.insideConfirmationCount / config.rules.entryConfirmationCount);
    if (vehicle.insideConfirmationCount < config.rules.entryConfirmationCount) return this.publishRaw(vehicle);

    vehicle.activeRegionId = candidate.id;
    vehicle.candidateRegionId = null;
    vehicle.exitConfirmationCount = 0;
    vehicle.state = "IN_REGION";
    this.log("VEHICLE_ENTERED_REGION", vehicle.vehicleId, candidate.id, vehicle.entryConfidence);
    this.log("VEHICLE_PINNED_TO_REGION_CENTER", vehicle.vehicleId, candidate.id, vehicle.entryConfidence);
    return this.publishCenter(vehicle, candidate, raw.timestamp);
  }

  private findContainingRegion(point: { x: number; y: number }): CompiledRegion | undefined {
    return this.config?.regions.find((region) => pointInPolygon(point, region));
  }

  private publishRaw(vehicle: VehicleRegionStatus): ProcessedPosition {
    const resolved = this.rawPosition(vehicle.lastRawPosition, vehicle.state);
    return this.send(vehicle, resolved);
  }

  private publishCenter(vehicle: VehicleRegionStatus, region: CompiledRegion, timestamp: string): ProcessedPosition {
    const raw = vehicle.lastRawPosition;
    const resolved: ProcessedPosition = {
      tagCode: vehicle.vehicleId,
      x: region.roomCenter.x,
      y: region.roomCenter.y,
      timestamp,
      positionSource: "REGION_CENTER",
      regionInference: {
        enabled: true,
        state: vehicle.state,
        regionId: region.id,
        confidence: vehicle.entryConfidence,
      },
      rawPosition: raw,
      lastRawDataTimestamp: raw.timestamp,
    };
    return this.send(vehicle, resolved);
  }

  private rawPosition(raw: TrackingPosition, state: VehicleRegionState): ProcessedPosition {
    return {
      ...raw,
      positionSource: "RAW",
      regionInference: { enabled: true, state, regionId: null },
      lastRawDataTimestamp: raw.timestamp,
    };
  }

  private send(vehicle: VehicleRegionStatus, resolved: ProcessedPosition): ProcessedPosition {
    vehicle.resolvedPosition = resolved;
    vehicle.lastPublishedTimestamp = this.now();
    this.publish(resolved);
    return resolved;
  }

  private resetToOutside(vehicle: VehicleRegionStatus): void {
    vehicle.state = "TRACKING_OUTSIDE";
    vehicle.activeRegionId = null;
    vehicle.candidateRegionId = null;
    vehicle.entryConfidence = 0;
    vehicle.insideConfirmationCount = 0;
    vehicle.exitConfirmationCount = 0;
  }

  private runScheduler(): void {
    if (!this.enabled || !this.config) return;
    const now = this.now();
    for (const vehicle of this.vehicles.values()) {
      try {
        if (!vehicle.activeRegionId) {
          if (now - vehicle.lastRawDataTimestamp >= Math.max(10_000, this.broadcastIntervalMs * 3)) vehicle.state = "LOCATION_LOST";
          continue;
        }
        if (now - vehicle.lastPublishedTimestamp < this.broadcastIntervalMs) continue;
        const region = this.config.regions.find((item) => item.id === vehicle.activeRegionId);
        if (!region) continue;
        if (now - vehicle.lastRawDataTimestamp >= this.broadcastIntervalMs) vehicle.state = "INFERRED_IN_REGION";
        this.publishCenter(vehicle, region, new Date(now).toISOString());
      } catch (error) {
        logger.error("region_engine.scheduler_failed", error, {
          vehicleId: vehicle.vehicleId,
        });
      }
    }
  }

  private log(event: string, vehicleId?: string, regionId?: string, score?: number): void {
    logger.info(`region_engine.${event.toLowerCase()}`, { vehicleId, regionId, score });
  }
}
