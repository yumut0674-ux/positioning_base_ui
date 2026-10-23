import { EntityService } from "./entityService";
import { PostgresEntityRepository } from "./entityRepository";
import { LocationService } from "./locationService";
import { PostgresPositionRepository } from "./positionRepository";
import { resolveConfiguredLocation } from "./regionLocationResolver";
import { roomDecisions } from "./roomDecisionRepository";

const entities = new PostgresEntityRepository();
const positions = new PostgresPositionRepository();

export const entityService = new EntityService(entities);
export const locationService = new LocationService(entities, positions, resolveConfiguredLocation, roomDecisions);
