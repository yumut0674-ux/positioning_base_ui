import type { RegionsConfig } from "@/src/features/regions/types/region.types";
import { trackingBuffer, type TrackingPosition } from "../trackingBuffer";
import { compileRegionsConfig, loadRegionsConfigForMap } from "./configLoader";
import { ProcessedPositionServer } from "./ProcessedPositionServer";
import { RegionPositionEngine } from "./RegionPositionEngine";
import { getRegionEngineRuntimeConfig } from "./runtimeConfig";
import type { CompiledRegionsConfig, RegionEngineStatus } from "./types";
import { logger } from "../logger";
import { roomDecisions } from "../location/roomDecisionRepository";
import { mapRepository } from "../maps/mapRepository";

interface ManagedEngine { readonly engine: RegionPositionEngine; warnings: readonly string[] }

/** Isolates inference and vehicle state by application map. */
export class RegionEngineController {
  private readonly runtime = getRegionEngineRuntimeConfig();
  private readonly output = new ProcessedPositionServer(this.runtime.processedPort, this.runtime.allowedOrigin, this.runtime.processedHost, true);
  private readonly engines = new Map<string, ManagedEngine>();
  private readonly unavailableMaps = new Set<string>();
  private readonly latestByTag = new Map<string, { readonly at: number; readonly mapId: string }>();
  private enabled = false;

  public async setEnabled(enabled: boolean): Promise<RegionEngineStatus> {
    if (enabled === this.enabled) return this.status();
    if (!enabled) {
      for (const managed of this.engines.values()) managed.engine.disable();
      this.engines.clear(); this.unavailableMaps.clear(); this.latestByTag.clear(); this.enabled = false;
      await this.output.stop();
      return this.status();
    }
    const catalog = await mapRepository.readCatalog();
    const liveMaps = catalog.maps.filter((map) => map.liveTrackingEnabled && map.configPath && ["active", "preview"].includes(map.status));
    const loaded = (await Promise.all(liveMaps.map(async (map) => {
      if (!map.regionsConfigPath) return null;
      try { return { mapId: map.id, compiled: await loadRegionsConfigForMap(map.id) }; }
      catch (error) { logger.error("region_engine.config_load_failed", error, { mapId: map.id }); return null; }
    }))).filter((item): item is { readonly mapId: string; readonly compiled: CompiledRegionsConfig } => item !== null);
    const loadedIds = new Set(loaded.map((item) => item.mapId));
    this.unavailableMaps.clear();
    for (const map of liveMaps) if (!loadedIds.has(map.id)) this.unavailableMaps.add(map.id);
    await this.output.start();
    this.enabled = true;
    for (const item of loaded) this.install(item.mapId, item.compiled);
    return this.status();
  }

  public ingest(position: TrackingPosition): void {
    if (!this.enabled || !position.mapId) return;
    const measuredAt = Date.parse(position.timestamp);
    const previous = this.latestByTag.get(position.tagCode);
    if (!Number.isFinite(measuredAt) || (previous && measuredAt <= previous.at)) return;
    const managed = this.engines.get(position.mapId);
    if (!managed) { logger.warn("region_engine.map_config_unavailable", { mapId: position.mapId }); return; }
    if (previous && previous.mapId !== position.mapId) this.engines.get(previous.mapId)?.engine.removeVehicle(position.tagCode);
    this.latestByTag.set(position.tagCode, { at: measuredAt, mapId: position.mapId });
    managed.engine.ingest(position);
  }

  public tick(): void { for (const managed of this.engines.values()) managed.engine.tick(); }
  public reloadConfig(config: RegionsConfig): void { this.reloadCompiledConfig(compileRegionsConfig(config), config.map.mapId); }
  public reloadCompiledConfig(compiled: CompiledRegionsConfig, mapId?: string): void {
    const resolvedMapId = mapId ?? [...this.engines.keys()][0];
    if (!resolvedMapId) throw new Error("MAP_ID_REQUIRED");
    if (this.enabled) { this.install(resolvedMapId, compiled); this.unavailableMaps.delete(resolvedMapId); }
  }
  public isEnabled(): boolean { return this.enabled; }

  public status(): RegionEngineStatus {
    const statuses = [...this.engines.entries()].map(([mapId, managed]) => [mapId, managed.engine.getStatus(this.runtime.rawPort, this.runtime.processedPort), managed] as const);
    return {
      enabled: this.enabled, rawPort: this.runtime.rawPort, processedPort: this.runtime.processedPort,
      activeVehicleCount: statuses.reduce((sum, [, status]) => sum + status.activeVehicleCount, 0),
      vehiclesInRegions: statuses.reduce((sum, [, status]) => sum + status.vehiclesInRegions, 0),
      configLoaded: statuses.length > 0,
      maps: Object.fromEntries([
        ...statuses.map(([mapId, status, managed]) => [mapId, { activeVehicleCount: status.activeVehicleCount, vehiclesInRegions: status.vehiclesInRegions, configLoaded: status.configLoaded, configVersion: status.configVersion, warnings: managed.warnings }] as const),
        ...[...this.unavailableMaps].map((mapId) => [mapId, { activeVehicleCount: 0, vehiclesInRegions: 0, configLoaded: false, warnings: ["Region config kullanılamıyor"] }] as const),
      ]),
      diagnostics: statuses.flatMap(([mapId, status]) => (status.diagnostics ?? []).map((diagnostic) => ({ ...diagnostic, vehicleId: `${diagnostic.vehicleId}@${mapId}` }))),
      decisionPersistence: roomDecisions.status(),
    } as RegionEngineStatus;
  }

  private install(mapId: string, compiled: CompiledRegionsConfig): void {
    const current = this.engines.get(mapId);
    if (current) { current.engine.reload(compiled); current.warnings = compiled.warnings ?? []; return; }
    const engine = new RegionPositionEngine((position) => { this.output.publish(position); roomDecisions.record(position); }, this.runtime.broadcastIntervalMs);
    engine.enable(compiled);
    this.engines.set(mapId, { engine, warnings: compiled.warnings ?? [] });
  }
}

declare global { var __uwbRegionEngineController: RegionEngineController | undefined }
export const regionEngineController = globalThis.__uwbRegionEngineController ?? new RegionEngineController();
if (!globalThis.__uwbRegionEngineController) {
  globalThis.__uwbRegionEngineController = regionEngineController;
  trackingBuffer.on("position", (position: TrackingPosition) => regionEngineController.ingest(position));
}
