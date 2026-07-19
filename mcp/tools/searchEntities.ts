import type { LocationApiClient } from "../client/locationApiClient";
import { searchEntitiesInputSchema } from "../schemas/toolSchemas";
import { executeTool } from "./toolResult";

export function createSearchEntitiesHandler(client: LocationApiClient, now?: () => Date) {
  return (input: unknown) => executeTool(
    searchEntitiesInputSchema, input, (validated) => client.searchEntities(validated), now,
  );
}
