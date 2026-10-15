import { readFile } from "node:fs/promises";
import type { TrackingPosition } from "../trackingBuffer";
import type { ProcessedPosition } from "../regionEngine/types";
import type { RegionsConfig } from "../../features/regions/types/region.types";
import type { PositionMessage } from "../../features/tracking/types/tracking.types";
import type { PersistedTagObservation, TagPresenceSnapshot } from "../../features/tracking/types/tagPresence.types";
import type { MapCatalogEntry } from "../maps/map.types";
import { mapRepository } from "../maps/mapRepository";
import { regionsConfigPathForMap } from "../regionEngine/configLoader";
import { isCorridorRegion } from "../../features/tracking/services/roomDisplayPolicy";
import { logger } from "../logger";
import { systemSettings } from "../settings/systemSettings";
import { TagPresenceService } from "./TagPresenceService";
import { PostgresTagPresenceRepository } from "./tagPresenceRepository";
import { resolveLastObservedLocation } from "./lastObservedLocation";

interface MapContext { readonly map?: MapCatalogEntry; readonly config?: RegionsConfig }

export function presencePosition(position: TrackingPosition | ProcessedPosition): PositionMessage {
  const p = position as Partial<ProcessedPosition> & TrackingPosition;
  return {
    id: p.tagCode.toUpperCase(), x: p.x, y: p.y, timestamp: Date.parse(p.lastRawDataTimestamp ?? p.timestamp),
    receivedAt: p.receivedAt, mapId: p.mapId ?? null, sourceZoneId: p.sourceZoneId, sourceZoneName: p.sourceZoneName,
    pdop: p.pdop ?? null, motionLabel: p.motionLabel, publishedAt: p.publishedAt, synthetic: p.synthetic,
    regionInference: p.regionInference, positionSource: p.positionSource,
    rawPosition: p.rawPosition, lastRawDataTimestamp: p.lastRawDataTimestamp,
  };
}

export class TagPresenceRuntime {
  public readonly service = new TagPresenceService();
  private readonly repository = new PostgresTagPresenceRepository();
  private readonly contexts = new Map<string, { at: number; value: Promise<MapContext> }>();
  private readonly dirty = new Map<string, PersistedTagObservation>();
  private starting?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private persistenceError: string | null = null;
  private settingsError: string | null = null;
  private lastFlush = 0;
  private restored = false;
  private lastRestoreAttempt = 0;

  public async start(): Promise<void> {
    this.starting ??= (async () => {
      await this.refreshSettings();
      await this.restore();
      this.timer = setInterval(() => {
        // Persistence outages must never pause visibility deadlines.
        this.service.tick();
        void this.tick();
      }, 1_000);
      this.timer.unref?.();
    })();
    await this.starting;
  }

  public snapshot(): TagPresenceSnapshot { return this.service.snapshot(this.settingsError ?? this.persistenceError); }

  public async observeRaw(position: TrackingPosition): Promise<void> {
    const context = await this.context(position.mapId ?? null);
    const raw = presencePosition(position);
    if (this.service.observeRaw(raw, resolveLastObservedLocation(raw, context.map, context.config))) {
      const state = this.service.get(raw.id)!;
      const { tagCode, lastRawReceivedAt, lastRawMeasuredAt, lastObservedLocation } = state;
      this.dirty.set(tagCode, { tagCode, raw, lastRawReceivedAt, lastRawMeasuredAt, lastObservedLocation });
      if (this.dirty.size > 5_000) this.dirty.delete(this.dirty.keys().next().value!);
    }
  }

  public observeDecision(position: ProcessedPosition): void { this.service.observeDecision(presencePosition(position)); }

  public invalidateMap(mapId: string): void {
    this.contexts.delete(mapId);
    this.service.invalidateMap(mapId);
  }

  public async refreshSettings(): Promise<void> {
    try { this.service.setSettings(await systemSettings.read()); this.settingsError = null; }
    catch (error) {
      if (!this.settingsError) logger.error("tag_presence.settings_failed", error);
      this.settingsError = "Takip ayarları okunamıyor; son uygulanan ayar kullanılıyor.";
    }
  }

  private async context(mapId: string | null): Promise<MapContext> {
    if (!mapId) return {};
    const cached = this.contexts.get(mapId);
    if (cached && Date.now() - cached.at < 5_000) return cached.value;
    const value = (async () => {
      let map: MapCatalogEntry | undefined;
      try {
        map = (await mapRepository.readCatalog()).maps.find(entry => entry.id === mapId);
        const config = JSON.parse(await readFile(regionsConfigPathForMap(mapId), "utf8")) as RegionsConfig;
        if (config.map?.mapId !== mapId || !Array.isArray(config.regions)) return { map };
        this.service.configureMap(mapId, new Set(config.regions.filter(region => !isCorridorRegion(region)).map(region => region.id)));
        return { map, config };
      } catch { return { map }; }
    })();
    this.contexts.set(mapId, { at: Date.now(), value });
    return value;
  }

  private async restore(): Promise<void> {
    this.lastRestoreAttempt = Date.now();
    try { this.service.restore(await this.repository.restore()); this.restored = true; this.persistenceError = null; }
    catch (error) {
      if (!this.persistenceError) logger.error("tag_presence.restore_failed", error);
      this.persistenceError = "Son konum kayıtları yüklenemiyor; canlı takip devam ediyor.";
    }
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.refreshSettings();
      this.service.tick();
      if (!this.restored && Date.now() - this.lastRestoreAttempt >= 15_000) await this.restore();
      if (this.dirty.size && Date.now() - this.lastFlush >= 5_000) {
        this.lastFlush = Date.now();
        const batch = [...this.dirty.values()].slice(0, 500);
        try {
          await this.repository.save(batch);
          for (const item of batch) if (this.dirty.get(item.tagCode) === item) this.dirty.delete(item.tagCode);
          if (this.restored) this.persistenceError = null;
        } catch (error) {
          if (!this.persistenceError) logger.error("tag_presence.save_failed", error);
          this.persistenceError = "Son konumlar kaydedilemiyor; canlı takip devam ediyor.";
        }
      }
    } finally { this.busy = false; }
  }
}

type PresenceHost = NodeJS.Process & { __uwbTagPresenceRuntime?: TagPresenceRuntime };
export const tagPresenceRuntime = (process as PresenceHost).__uwbTagPresenceRuntime ??= new TagPresenceRuntime();
