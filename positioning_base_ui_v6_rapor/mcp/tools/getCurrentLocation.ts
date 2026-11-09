import type { LocationApiClient } from "../client/locationApiClient";
import { currentLocationInputSchema } from "../schemas/toolSchemas";
import { executeTool } from "./toolResult";

export function createGetCurrentLocationHandler(client: LocationApiClient, now?: () => Date) {
  return (input: unknown) => executeTool(
    currentLocationInputSchema, input, (validated) => client.getCurrentLocation(validated.entityId), now,
  );
}
