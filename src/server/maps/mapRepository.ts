import { readFile } from "node:fs/promises";
import path from "node:path";
import embeddedCatalog from "../../../config/maps/catalog.json";
import embeddedOrthopedicsMap from "../../../config/maps/kat1-ortopedi/map.json";
import embeddedSportsCorridorMap from "../../../config/maps/spor-koridor/map.json";
import { mapCatalogSchema, mapDetailsSchema } from "./map.validation";
import type { MapCatalog, MapCatalogEntry, MapDetails } from "./map.types";

export interface MapRepository {
  readCatalog(): Promise<MapCatalog>;
  readMapDetails(entry: MapCatalogEntry): Promise<MapDetails>;
}

export class FileMapRepository implements MapRepository {
  private readonly mapsDirectory: string;
  private readonly useEmbeddedFallback: boolean;

  public constructor(mapsDirectory = path.join(process.cwd(), "config", "maps")) {
    this.mapsDirectory = path.resolve(mapsDirectory);
    this.useEmbeddedFallback = mapsDirectory === path.join(process.cwd(), "config", "maps");
  }

  public async readCatalog(): Promise<MapCatalog> {
    const value = await this.readJson(path.join(this.mapsDirectory, "catalog.json"), embeddedCatalog);
    return mapCatalogSchema.parse(value) as MapCatalog;
  }

  public async readMapDetails(entry: MapCatalogEntry): Promise<MapDetails> {
    if (!entry.configPath) throw new Error("MAP_CONFIG_UNAVAILABLE");
    const configFile = path.resolve(this.mapsDirectory, entry.configPath);
    if (!configFile.startsWith(`${this.mapsDirectory}${path.sep}`)) throw new Error("MAP_CONFIG_PATH_INVALID");
    const fallback = entry.id === embeddedSportsCorridorMap.id
      ? embeddedSportsCorridorMap
      : entry.id === embeddedOrthopedicsMap.id
        ? embeddedOrthopedicsMap
        : undefined;
    const value = await this.readJson(configFile, fallback);
    return mapDetailsSchema.parse(value) as MapDetails;
  }

  private async readJson(filePath: string, fallback: unknown): Promise<unknown> {
    try {
      return JSON.parse(await readFile(filePath, "utf8")) as unknown;
    } catch (error) {
      if (this.useEmbeddedFallback && (error as NodeJS.ErrnoException).code === "ENOENT" && fallback !== undefined) return fallback;
      throw error;
    }
  }
}

export const mapRepository = new FileMapRepository();
