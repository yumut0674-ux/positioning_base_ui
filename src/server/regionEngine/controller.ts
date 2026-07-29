import type { RegionsConfig } from "@/src/features/regions/types/region.types";
import { trackingBuffer, type TrackingPosition } from "../trackingBuffer";
import { compileRegionsConfig, loadRegionsConfig } from "./configLoader";
import { ProcessedPositionServer } from "./ProcessedPositionServer";
import { RegionPositionEngine } from "./RegionPositionEngine";
import { getRegionEngineRuntimeConfig } from "./runtimeConfig";
import type { RegionEngineStatus } from "./types";
import { logger } from "../logger";

export class RegionEngineController {
  private readonly runtime = getRegionEngineRuntimeConfig();
  private readonly output = new ProcessedPositionServer(this.runtime.processedPort, this.runtime.allowedOrigin, true);
  private readonly engine = new RegionPositionEngine(
    (position) => this.output.publish(position),
    this.runtime.broadcastIntervalMs,
  );

  public async setEnabled(enabled: boolean): Promise<RegionEngineStatus> {
    if (enabled === this.isEnabled()) return this.status();
    if (!enabled) {
      this.engine.disable();
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
    this.engine.enable(compiled);
    return this.status();
  }

  public ingest(position: TrackingPosition): void {
    this.engine.ingest(position);
  }

  public tick(): void {
    this.engine.tick();
  }

  public reloadConfig(config: RegionsConfig): void {
    const compiled = compileRegionsConfig(config);
    if (this.isEnabled()) this.engine.reload(compiled);
  }

  public isEnabled(): boolean {
    return this.engine.getStatus(this.runtime.rawPort, this.runtime.processedPort).enabled;
  }

  public status(): RegionEngineStatus {
    return this.engine.getStatus(this.runtime.rawPort, this.runtime.processedPort);
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
