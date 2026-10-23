import type { MapCatalog, MapDetails } from "./map.types";
import { mapIdSchema } from "./map.validation";
import { mapRepository, type MapRepository } from "./mapRepository";

export class MapRequestError extends Error {
  public constructor(
    public readonly code: "INVALID_MAP_ID" | "MAP_NOT_FOUND" | "MAP_NOT_CONFIGURED" | "MAP_CONFIG_INVALID",
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export class MapService {
  public constructor(private readonly repository: MapRepository = mapRepository) {}

  public async getCatalog(): Promise<MapCatalog> {
    return this.repository.readCatalog();
  }

  public async getMapDetails(rawMapId: string): Promise<MapDetails> {
    const parsed = mapIdSchema.safeParse(rawMapId);
    if (!parsed.success) throw new MapRequestError("INVALID_MAP_ID", "Harita seçimi geçersiz.", 400);
    const catalog = await this.repository.readCatalog();
    const entry = catalog.maps.find((candidate) => candidate.id === parsed.data);
    if (!entry) throw new MapRequestError("MAP_NOT_FOUND", "İstenen harita bulunamadı.", 404);
    if (!entry.configPath) throw new MapRequestError("MAP_NOT_CONFIGURED", "Bu harita henüz planlanıyor.", 409);
    try {
      const details = await this.repository.readMapDetails(entry);
      if (details.id !== entry.id || details.status !== entry.status || details.liveTrackingEnabled !== entry.liveTrackingEnabled) {
        throw new Error("MAP_CONFIG_CATALOG_MISMATCH");
      }
      return details;
    } catch (error) {
      if (error instanceof MapRequestError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new MapRequestError("MAP_NOT_CONFIGURED", "Bu haritanın yapılandırması henüz hazır değil.", 409);
      }
      throw new MapRequestError("MAP_CONFIG_INVALID", "Harita yapılandırması geçersiz.", 500);
    }
  }
}

export const mapService = new MapService();
