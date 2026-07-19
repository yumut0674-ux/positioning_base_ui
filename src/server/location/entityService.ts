import type { EntityRepository } from "./entityRepository";
import { LocationError } from "./locationErrors";
import { successEnvelope, type SearchEntitiesData, type SuccessEnvelope, type TrackedEntity } from "./location.types";

const LEGACY_WARNING = "Kalıcı tracked_entities/tag_assignments şeması bulunmadığı için tags tablosu geriye uyumlu varlık görünümü olarak kullanıldı.";

export class EntityService {
  public constructor(private readonly entities: EntityRepository) {}

  public async search(query: string, limit: number, now?: () => Date): Promise<SuccessEnvelope<SearchEntitiesData>> {
    const matches = await this.entities.search(query, limit);
    const status = matches.length === 0 ? "no_data" : matches.length > 1 ? "ambiguous" : "complete";
    return successEnvelope({ matches }, status, [], now);
  }

  public async requireEntity(entityId: number): Promise<TrackedEntity> {
    const entity = await this.entities.getById(entityId);
    if (!entity) throw new LocationError("ENTITY_NOT_FOUND", { details: { entityId } });
    return entity;
  }

  public warningsFor(entity: TrackedEntity): readonly string[] {
    return entity.usesLegacyTagModel ? [LEGACY_WARNING] : [];
  }
}
