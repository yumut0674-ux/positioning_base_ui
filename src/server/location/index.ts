import { EntityService } from "./entityService";
import { PostgresEntityRepository } from "./entityRepository";
import { LocationService } from "./locationService";
import { PostgresPositionRepository } from "./positionRepository";
import { resolveConfiguredLocation } from "./regionLocationResolver";

const entities = new PostgresEntityRepository();
const positions = new PostgresPositionRepository();

export const entityService = new EntityService(entities);
export const locationService = new LocationService(entities, positions, resolveConfiguredLocation);
