import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import embeddedIntensiveCareFilter from "../../config/maps/necmettin-yogun-bakim/tracking-filter.json";
import { DEFAULT_PDOP_FILTER_SETTINGS, parsePdopFilterSettings, type PdopFilterSettings } from "../shared/tracking/pdop";
import { mapIdSchema } from "./maps/map.validation";

export class TrackingFilterConfigurationError extends Error {}

/** Separate files keep input-quality changes independent of room-engine config and state. */
export class MapTrackingFilterSettings {
  private readonly cache = new Map<string, { settings: PdopFilterSettings; checkedAt: number }>();
  private readonly revisions = new Map<string, number>();
  private readonly writes = new Map<string, Promise<PdopFilterSettings>>();
  private readonly mapsDirectory: string;
  private readonly useEmbeddedFallback: boolean;

  public constructor(mapsDirectory = path.join(process.cwd(), "config", "maps"), private readonly cacheMs = 1_000, private readonly now = Date.now) {
    this.mapsDirectory = path.resolve(mapsDirectory);
    this.useEmbeddedFallback = this.mapsDirectory === path.resolve(process.cwd(), "config", "maps");
  }

  private filePath(mapId: string): string {
    if (!mapIdSchema.safeParse(mapId).success) throw new Error("Harita seçimi geçersiz");
    return path.join(this.mapsDirectory, mapId, "tracking-filter.json");
  }

  public async read(mapId: string | null, fresh = false): Promise<PdopFilterSettings> {
    if (mapId === null) return DEFAULT_PDOP_FILTER_SETTINGS;
    const target = this.filePath(mapId);
    const cached = this.cache.get(mapId);
    if (!fresh && cached && this.now() - cached.checkedAt < this.cacheMs) return cached.settings;
    const revision = this.revisions.get(mapId) ?? 0;
    let settings: PdopFilterSettings;
    try {
      settings = parsePdopFilterSettings(JSON.parse(await readFile(target, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new TrackingFilterConfigurationError("Haritanın PDOP filtre ayarları okunamadı");
      settings = this.useEmbeddedFallback && mapId === "necmettin-yogun-bakim"
        ? parsePdopFilterSettings(embeddedIntensiveCareFilter)
        : DEFAULT_PDOP_FILTER_SETTINGS;
    }
    // A read started before a successful save must never put old settings back into the cache.
    if (revision !== (this.revisions.get(mapId) ?? 0)) return this.read(mapId);
    this.cache.set(mapId, { settings, checkedAt: this.now() });
    return settings;
  }

  public save(mapId: string, value: unknown): Promise<PdopFilterSettings> {
    const target = this.filePath(mapId);
    const settings = parsePdopFilterSettings(value);
    const previous = this.writes.get(mapId) ?? Promise.resolve(settings);
    const write = previous.catch(() => settings).then(async () => {
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
        await rename(temporary, target);
      } catch {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw new TrackingFilterConfigurationError("Haritanın PDOP filtre ayarları kaydedilemedi");
      }
      this.revisions.set(mapId, (this.revisions.get(mapId) ?? 0) + 1);
      this.cache.set(mapId, { settings, checkedAt: this.now() });
      return settings;
    });
    this.writes.set(mapId, write);
    void write.finally(() => { if (this.writes.get(mapId) === write) this.writes.delete(mapId); }).catch(() => undefined);
    return write;
  }
}

declare global {
  var __uwbMapTrackingFilterSettings: MapTrackingFilterSettings | undefined;
}

export const mapTrackingFilterSettings = globalThis.__uwbMapTrackingFilterSettings ?? new MapTrackingFilterSettings();
globalThis.__uwbMapTrackingFilterSettings ??= mapTrackingFilterSettings;
