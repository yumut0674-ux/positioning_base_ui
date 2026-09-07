import type { RegionsConfig } from "@/src/features/regions/types/region.types";
import { trackingBuffer, type TrackingPosition } from "../trackingBuffer";
import { compileRegionsConfig, loadRegionsConfig } from "./configLoader";
import { ProcessedPositionServer } from "./ProcessedPositionServer";
import { RegionPositionEngine } from "./RegionPositionEngine";
import { getRegionEngineRuntimeConfig } from "./runtimeConfig";
import type { RegionEngineStatus } from "./types";
import { logger } from "../logger";
import { LegacyRegionPositionEngine } from "./LegacyRegionPositionEngine";
import { roomDecisions } from "../location/roomDecisionRepository";

export class RegionEngineController {
  private mode: "inference" | "shadow" | "legacy" = "inference";
  private comparisons: { tagCode: string; timestamp: string; current: string | null; legacy: string | null }[] = [];
  private warnings: readonly string[] = [];
  private readonly runtime = getRegionEngineRuntimeConfig();
  private readonly output = new ProcessedPositionServer(
    this.runtime.processedPort,
    this.runtime.allowedOrigin,
    this.runtime.processedHost,
    true,
  );
  private readonly engine = new RegionPositionEngine(
    (position) => { if (this.mode === "inference") { this.output.publish(position); roomDecisions.record(position); } },
    this.runtime.broadcastIntervalMs,
  );
  private readonly legacy = new LegacyRegionPositionEngine((position) => { if (this.mode !== "inference") this.output.publish(position); }, this.runtime.broadcastIntervalMs);

  public async setEnabled(enabled: boolean): Promise<RegionEngineStatus> {
    if (enabled === this.isEnabled()) return this.status();
    if (!enabled) {
      this.engine.disable();
      this.legacy.disable();
      await this.output.stop();
      return this.status();
    }

    let compiled;
    try {
      compiled = await loadRegionsConfig();
    } catch (error) {
      logger.error("region_engine.config_load_failed", error);
      throw new Error(`Region config yüklenemedi: ${error instanceof Error ? error.message : String(error)}`);
    }

    await this.output.start();
    this.mode = compiled.mode ?? "inference";
    this.warnings = compiled.warnings ?? [];
    this.engine.enable(compiled);
    if (this.mode !== "inference") this.legacy.enable(compiled);
    return this.status();
  }

  public ingest(position: TrackingPosition): void {
    const current = this.engine.ingest(position);
    const legacy = this.mode !== "inference" ? this.legacy.ingest(position) : undefined;
    if (this.mode === "shadow" && current && legacy) {
      this.comparisons.push({ tagCode: position.tagCode, timestamp: position.timestamp, current: current.regionInference.regionId, legacy: legacy.regionInference.regionId });
      if (this.comparisons.length > 1000) this.comparisons.shift();
    }
  }

  public tick(): void {
    this.engine.tick();
    if (this.mode !== "inference") this.legacy.tick();
  }

  public reloadConfig(config: RegionsConfig): void {
    const compiled = compileRegionsConfig(config);
    if (this.isEnabled()) this.engine.reload(compiled);
    this.warnings = compiled.warnings ?? [];
    this.mode = compiled.mode ?? "inference";
    this.legacy.disable();
    if (this.isEnabled() && this.mode !== "inference") this.legacy.enable(compiled);
  }

  public isEnabled(): boolean {
    return this.engine.getStatus(this.runtime.rawPort, this.runtime.processedPort).enabled;
  }

  public status(): RegionEngineStatus {
    return { ...this.engine.getStatus(this.runtime.rawPort, this.runtime.processedPort), mode: this.mode, warnings: this.warnings, shadowComparisons: this.comparisons, decisionPersistence: roomDecisions.status() } as RegionEngineStatus;
  }
}

declare global {
  var __uwbRegionEngineController: RegionEngineController | undefined;
}

export const regionEngineController = globalThis.__uwbRegionEngineController ?? new RegionEngineController();
if (!globalThis.__uwbRegionEngineController) {
  globalThis.__uwbRegionEngineController = regionEngineController;
  trackingBuffer.on("position", (position: TrackingPosition) => regionEngineController.ingest(position));
}
