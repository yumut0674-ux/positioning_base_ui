import type { RegionsConfig } from "@/src/features/regions/types/region.types";
import { trackingBuffer, type TrackingPosition } from "../trackingBuffer";
import { compileRegionsConfig, loadRegionsConfigForMap } from "./configLoader";
import { ProcessedPositionServer } from "./ProcessedPositionServer";
import { RegionPositionEngine, ROOM_ENGINE_VERSION } from "./RegionPositionEngine";
import { getRegionEngineRuntimeConfig } from "./runtimeConfig";
import type { CompiledRegionsConfig, RegionEngineStatus } from "./types";
import { logger } from "../logger";
import { roomDecisions } from "../location/roomDecisionRepository";
import { mapRepository } from "../maps/mapRepository";
import { AreaTransitionEngine } from "./AreaTransitionEngine";
import { areaTransitions } from "./areaTransitionRepository";

interface ManagedEngine { readonly engine: RegionPositionEngine; warnings: readonly string[] }
interface RegionEngineGlobalRegistration {
  readonly version: string;
  readonly revision?: string;
  readonly controller: RegionEngineController;
  readonly listener: (position: TrackingPosition) => void;
}

const POSITION_LISTENER_MARK = Symbol.for("uwb.regionEngine.positionListener");
export const REGION_ENGINE_CONTROLLER_REVISION = "region-controller-6";
type MarkedPositionListener = ((position: TrackingPosition) => void) & { [POSITION_LISTENER_MARK]?: boolean };

/** Isolates inference and vehicle state by application map. */
export class RegionEngineController {
  private readonly runtime = getRegionEngineRuntimeConfig();
  private readonly output: ProcessedPositionServer;
  private readonly engines = new Map<string, ManagedEngine>();
  private readonly unavailableMaps = new Set<string>();
  private readonly latestByTag = new Map<string, { readonly at: number; readonly mapId: string }>();
  private readonly areaConfigs = new Map<string, CompiledRegionsConfig>();
  private readonly areaSourceZones = new Map<string, readonly string[]>();
  private readonly areaSourceSignals = new Map<string, Map<string, { healthy: boolean; at: number }>>();
  private areaEngine: AreaTransitionEngine | null = null;
  private areaTimer: ReturnType<typeof setInterval> | null = null;
  private areaError: string | null = null;
  private enabled = false;
  private disposed = false;
  private disposePromise: Promise<void> | null = null;

  public readonly engineVersion = ROOM_ENGINE_VERSION;

  public constructor(private readonly startupBarrier: Promise<void> = Promise.resolve()) {
    this.output = new ProcessedPositionServer(this.runtime.processedPort, this.runtime.allowedOrigin, this.runtime.processedHost, true);
  }

  public async setEnabled(enabled: boolean): Promise<RegionEngineStatus> {
    if (this.disposed) {
      if (enabled) throw new Error(`Region engine controller ${this.engineVersion} kullanımdan kaldırıldı`);
      return this.status();
    }
    if (enabled === this.enabled) return this.status();
    if (!enabled) {
      if (this.areaTimer) clearInterval(this.areaTimer); this.areaTimer = null;
      for (const managed of this.engines.values()) managed.engine.disable();
      this.engines.clear(); this.unavailableMaps.clear(); this.latestByTag.clear(); this.areaConfigs.clear(); this.areaSourceZones.clear(); this.areaSourceSignals.clear(); this.areaEngine = null; this.areaError = null; this.enabled = false;
      await this.output.stop();
      await areaTransitions.flush();
      return this.status();
    }
    // A replacement controller must not probe/bind the SSE port until the stale owner has fully stopped.
    await this.startupBarrier;
    if (this.disposed) throw new Error(`Region engine controller ${this.engineVersion} kullanımdan kaldırıldı`);
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
    this.areaSourceZones.clear(); this.areaSourceSignals.clear();
    for (const map of liveMaps) this.areaSourceZones.set(map.id, map.trackingZoneIds.map(zone => zone.toLocaleLowerCase("en-US")));
    if (this.disposed) throw new Error(`Region engine controller ${this.engineVersion} kullanımdan kaldırıldı`);
    await this.output.start();
    if (this.disposed) { await this.output.stop(); return this.status(); }
    for (const item of loaded) this.install(item.mapId, item.compiled);
    try {
      const restored = await areaTransitions.restore();
      this.areaEngine = new AreaTransitionEngine(this.areaConfigs, (event, state) => areaTransitions.saveEvent(event, state),
        state => areaTransitions.saveState(state), count => areaTransitions.ensureEventCapacity(count));
      this.areaEngine.restore(restored);
      this.areaError = null;
    } catch (error) { logger.error("area_transition.restore_failed", error); this.areaEngine = null; this.areaError = error instanceof Error ? error.message : String(error); }
    this.enabled = true;
    if (this.areaEngine) { this.areaTimer = setInterval(() => this.tickAreas(), 1000); this.areaTimer.unref?.(); }
    return this.status();
  }

  public ingest(position: TrackingPosition): void {
    if (!this.enabled) return;
    if (!position.mapId) return;
    const measuredAt = Date.parse(position.timestamp);
    const previous = this.latestByTag.get(position.tagCode);
    if (!Number.isFinite(measuredAt) || (previous && measuredAt <= previous.at)) return;
    const managed = this.engines.get(position.mapId);
    if (!managed) { logger.warn("region_engine.map_config_unavailable", { mapId: position.mapId }); return; }
    this.areaEngine?.ingest(position);
    if (previous && previous.mapId !== position.mapId) this.engines.get(previous.mapId)?.engine.removeVehicle(position.tagCode);
    this.latestByTag.set(position.tagCode, { at: measuredAt, mapId: position.mapId });
    managed.engine.ingest(position);
  }

  public noteSourceHealth(mapId: string, zoneId: string, healthy: boolean, at = Date.now()): void {
    const expected = this.areaSourceZones.get(mapId), zone = zoneId.toLocaleLowerCase("en-US");
    if (!expected?.includes(zone)) return;
    const signals = this.areaSourceSignals.get(mapId) ?? new Map();
    signals.set(zone, { healthy, at }); this.areaSourceSignals.set(mapId, signals);
    if (!healthy) { this.areaEngine?.noteSourceHealth(mapId, false, at); return; }
    if (expected.every(id => { const signal = signals.get(id); return signal?.healthy && at - signal.at <= 15_000; }))
      this.areaEngine?.noteSourceHealth(mapId, true, at);
  }
  private tickAreas(): void {
    try { this.areaEngine?.tick(Date.now()); if (!areaTransitions.status().error) this.areaError = null; }
    catch (error) { this.areaError = error instanceof Error ? error.message : String(error); logger.error("area_transition.tick_failed", error); }
  }
  public tick(): void { for (const managed of this.engines.values()) managed.engine.tick(); this.tickAreas(); }
  public reloadConfig(config: RegionsConfig): void { this.reloadCompiledConfig(compileRegionsConfig(config), config.map.mapId); }
  public reloadCompiledConfig(compiled: CompiledRegionsConfig, mapId?: string): void {
    const resolvedMapId = mapId ?? [...this.engines.keys()][0];
    if (!resolvedMapId) throw new Error("MAP_ID_REQUIRED");
    if (this.enabled) {
      const snapshot = this.areaEngine?.snapshot() ?? [];
      this.install(resolvedMapId, compiled); this.unavailableMaps.delete(resolvedMapId);
      if (this.areaEngine) { this.areaEngine = new AreaTransitionEngine(this.areaConfigs, (event, state) => areaTransitions.saveEvent(event, state),
        state => areaTransitions.saveState(state), count => areaTransitions.ensureEventCapacity(count)); this.areaEngine.restore(snapshot); }
    }
  }
  public isEnabled(): boolean { return this.enabled; }
  public isDisposed(): boolean { return this.disposed; }

  /** Stops timers and the SSE/TCP owner once; safe to call during hot replacement. */
  public dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    if (this.areaTimer) clearInterval(this.areaTimer); this.areaTimer = null;
    for (const managed of this.engines.values()) managed.engine.disable();
    this.engines.clear(); this.unavailableMaps.clear(); this.latestByTag.clear(); this.areaConfigs.clear(); this.areaSourceZones.clear(); this.areaSourceSignals.clear(); this.areaEngine = null; this.areaError = null; this.enabled = false;
    return this.disposePromise = Promise.all([this.output.stop(), areaTransitions.flush()]).then(() => undefined);
  }

  public status(): RegionEngineStatus {
    const statuses = [...this.engines.entries()].map(([mapId, managed]) => [mapId, managed.engine.getStatus(this.runtime.rawPort, this.runtime.processedPort), managed] as const);
    const areaPersistence = areaTransitions.status();
    const areaDiagnostics = this.areaEngine?.diagnostics(Date.now()) ?? { sourceHealth: {}, pendingExits: [] };
    return {
      enabled: this.enabled, engineVersion: ROOM_ENGINE_VERSION, rawPort: this.runtime.rawPort, processedPort: this.runtime.processedPort,
      controllerRevision: REGION_ENGINE_CONTROLLER_REVISION,
      regionEngineListenerCount: trackingBuffer.rawListeners("position").filter(isRegionEngineListener).length,
      activeVehicleCount: statuses.reduce((sum, [, status]) => sum + status.activeVehicleCount, 0),
      vehiclesInRegions: statuses.reduce((sum, [, status]) => sum + status.vehiclesInRegions, 0),
      configLoaded: statuses.length > 0,
      warnings: [
        ...(this.areaError || areaPersistence.error ? [`Büyük alan kalıcılığı kullanılamıyor: ${this.areaError ?? areaPersistence.error}`] : []),
        ...(areaDiagnostics.pendingExits.some(item => item.sourceHealth !== "healthy") ? ["Bekleyen alan çıkışları var; kaynak sağlığı belirsiz veya kesintide olduğu için karar ertelendi."] : []),
      ],
      areaTracking: { active: this.areaEngine !== null, ...areaPersistence, ...areaDiagnostics },
      // The map-specific status remains authoritative for multi-map deployments; expose
      // the same value at the root when exactly one active map is loaded.
      ...(statuses.length === 1 && statuses[0][1].configVersion ? { configVersion: statuses[0][1].configVersion } : {}),
      maps: Object.fromEntries([
        ...statuses.map(([mapId, status, managed]) => [mapId, { engineVersion: status.engineVersion ?? ROOM_ENGINE_VERSION, activeVehicleCount: status.activeVehicleCount, vehiclesInRegions: status.vehiclesInRegions, configLoaded: status.configLoaded, configVersion: status.configVersion, warnings: managed.warnings }] as const),
        ...[...this.unavailableMaps].map((mapId) => [mapId, { engineVersion: ROOM_ENGINE_VERSION, activeVehicleCount: 0, vehiclesInRegions: 0, configLoaded: false, warnings: ["Region config kullanılamıyor"] }] as const),
      ]),
      diagnostics: statuses.flatMap(([mapId, status]) => (status.diagnostics ?? []).map((diagnostic) => ({ ...diagnostic, vehicleId: `${diagnostic.vehicleId}@${mapId}` }))),
      decisionPersistence: roomDecisions.status(),
    } as RegionEngineStatus;
  }

  private install(mapId: string, compiled: CompiledRegionsConfig): void {
    this.areaConfigs.set(mapId, compiled);
    const current = this.engines.get(mapId);
    if (current) { current.engine.reload(compiled); current.warnings = compiled.warnings ?? []; return; }
    const engine = new RegionPositionEngine((position) => { this.output.publish(position); roomDecisions.record(position); }, this.runtime.broadcastIntervalMs);
    engine.enable(compiled);
    this.engines.set(mapId, { engine, warnings: compiled.warnings ?? [] });
  }
}

function isRegionEngineListener(listener: CallableFunction): boolean {
  if ((listener as MarkedPositionListener)[POSITION_LISTENER_MARK]) return true;
  // One-time cleanup for listeners created by controller modules predating the marker.
  return Function.prototype.toString.call(listener).includes("regionEngineController.ingest");
}

function removeRegionEngineListeners(except?: MarkedPositionListener): void {
  for (const listener of trackingBuffer.rawListeners("position")) {
    if (listener !== except && isRegionEngineListener(listener)) trackingBuffer.off("position", listener as MarkedPositionListener);
  }
}

function retireController(controller: RegionEngineController | undefined): Promise<void> {
  if (!controller) return Promise.resolve();
  if (typeof controller.dispose === "function") return controller.dispose().catch((error) => logger.error("region_engine.stale_controller_dispose_failed", error));
  return Promise.resolve(controller.setEnabled(false)).then(() => undefined).catch((error) => logger.error("region_engine.stale_controller_disable_failed", error));
}

export function installGlobalRegionEngineController(): RegionEngineController {
  const registered = globalThis.__uwbRegionEngineControllerRegistration;
  if (registered?.version === ROOM_ENGINE_VERSION
    && registered.revision === REGION_ENGINE_CONTROLLER_REVISION
    && registered.controller.engineVersion === ROOM_ENGINE_VERSION
    && !registered.controller.isDisposed()) {
    removeRegionEngineListeners(registered.listener as MarkedPositionListener);
    if (!trackingBuffer.rawListeners("position").includes(registered.listener)) trackingBuffer.on("position", registered.listener);
    globalThis.__uwbRegionEngineController = registered.controller;
    return registered.controller;
  }

  removeRegionEngineListeners();
  const staleController = registered?.controller ?? globalThis.__uwbRegionEngineController;
  const restoreEnabled = staleController?.isEnabled() ?? false;
  const retirement = retireController(staleController);
  const controller = new RegionEngineController(retirement);
  const listener: MarkedPositionListener = (position) => controller.ingest(position);
  listener[POSITION_LISTENER_MARK] = true;
  trackingBuffer.on("position", listener);
  globalThis.__uwbRegionEngineControllerRegistration = { version: ROOM_ENGINE_VERSION, revision: REGION_ENGINE_CONTROLLER_REVISION, controller, listener };
  globalThis.__uwbRegionEngineController = controller;
  if (restoreEnabled) void controller.setEnabled(true).catch((error) => logger.error("region_engine.replacement_enable_failed", error));
  return controller;
}

declare global {
  var __uwbRegionEngineController: RegionEngineController | undefined;
  var __uwbRegionEngineControllerRegistration: RegionEngineGlobalRegistration | undefined;
}

export const regionEngineController = installGlobalRegionEngineController();
