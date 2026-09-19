import { logger } from "../logger";
import { mapRepository, type MapRepository } from "./mapRepository";

export interface ZoneResolution { readonly mapId: string | null; readonly resolved: boolean }

export class ZoneMapResolver {
  private index = new Map<string, string>();
  private refreshedAt = 0;
  private refreshPromise: Promise<void> | null = null;
  private readonly unknownLoggedAt = new Map<string, number>();

  public constructor(private readonly repository: MapRepository = mapRepository, private readonly cacheMs = 30_000, private readonly now = Date.now) {}

  public async resolve(sourceZoneId: string | null): Promise<ZoneResolution> {
    if (sourceZoneId === null) return { mapId: null, resolved: false };
    await this.refresh();
    const mapId = this.index.get(sourceZoneId.toLocaleLowerCase("en-US")) ?? null;
    if (!mapId) this.logUnknown(sourceZoneId);
    return { mapId, resolved: mapId !== null };
  }

  public invalidate(): void { this.refreshedAt = 0; }

  private async refresh(): Promise<void> {
    if (this.refreshedAt !== 0 && this.now() - this.refreshedAt < this.cacheMs) return;
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.repository.readCatalog().then((catalog) => {
      const next = new Map<string, string>();
      for (const map of catalog.maps.filter((entry) => entry.liveTrackingEnabled && entry.configPath && ["active", "preview"].includes(entry.status))) {
        for (const zoneId of map.trackingZoneIds) {
          const key = zoneId.toLocaleLowerCase("en-US");
          const existing = next.get(key);
          if (existing && existing !== map.id) throw new Error(`DUPLICATE_TRACKING_ZONE:${zoneId}`);
          next.set(key, map.id);
        }
      }
      this.index = next;
      this.refreshedAt = this.now();
    }).finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  private logUnknown(zoneId: string): void {
    const last = this.unknownLoggedAt.get(zoneId) ?? 0;
    if (this.now() - last < 60_000) return;
    this.unknownLoggedAt.set(zoneId, this.now());
    logger.warn("tracking.zone_unresolved", { zoneId });
  }
}

export const zoneMapResolver = new ZoneMapResolver();
