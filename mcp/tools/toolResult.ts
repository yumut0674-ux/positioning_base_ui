import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, ZodError, type ZodTypeAny } from "zod";
import { LocationError, toErrorEnvelope } from "../../src/server/location/locationErrors";
import { isErrorEnvelope, type ApiEnvelope } from "../../src/server/location/location.types";

function asStructuredContent(envelope: ApiEnvelope<unknown>): Record<string, unknown> {
  return isErrorEnvelope(envelope)
    ? { error: envelope.error, meta: envelope.meta }
    : { data: envelope.data, meta: envelope.meta };
}

export function toToolResult(envelope: ApiEnvelope<unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(envelope) }],
    structuredContent: asStructuredContent(envelope),
    ...(isErrorEnvelope(envelope) ? { isError: true } : {}),
  };
}

export async function executeTool<Schema extends ZodTypeAny>(
  schema: Schema, input: unknown,
  operation: (validated: z.output<Schema>) => Promise<ApiEnvelope<unknown>>,
  now?: () => Date,
): Promise<CallToolResult> {
  try {
    return toToolResult(await operation(schema.parse(input)));
  } catch (error) {
    const safeError = error instanceof ZodError
      ? new LocationError("VALIDATION_ERROR", { details: { fields: error.issues.map((issue) => issue.path.join(".")) } })
      : error;
    return toToolResult(toErrorEnvelope(safeError, now));
  }
}
