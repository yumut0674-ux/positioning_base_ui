import type { LocationApiClient } from "../client/locationApiClient";
import { locationHistoryInputSchema } from "../schemas/toolSchemas";
import { executeTool } from "./toolResult";

export function createGetLocationHistoryHandler(client: LocationApiClient, now?: () => Date) {
  return (input: unknown) => executeTool(
    locationHistoryInputSchema, input, (validated) => client.getLocationHistory(validated), now,
  );
}
