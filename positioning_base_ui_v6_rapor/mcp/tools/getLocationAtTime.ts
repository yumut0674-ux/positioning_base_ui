import type { LocationApiClient } from "../client/locationApiClient";
import { locationAtTimeInputSchema } from "../schemas/toolSchemas";
import { executeTool } from "./toolResult";

export function createGetLocationAtTimeHandler(client: LocationApiClient, now?: () => Date) {
  return (input: unknown) => executeTool(
    locationAtTimeInputSchema, input, (validated) => client.getLocationAtTime(validated), now,
  );
}
