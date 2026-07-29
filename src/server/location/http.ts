import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { LocationError, statusForError, toErrorEnvelope } from "./locationErrors";
import { logger } from "../logger";

export async function locationRoute(handler: () => Promise<unknown>): Promise<NextResponse> {
  try {
    return NextResponse.json(await handler());
  } catch (error) {
    const safeError = error instanceof ZodError
      ? new LocationError("VALIDATION_ERROR", { details: { fields: error.issues.map((issue) => issue.path.join(".")) } })
      : error;
    const status = statusForError(safeError);
    if (status >= 500) logger.error("location.api_failed", error, { status });
    return NextResponse.json(toErrorEnvelope(safeError), { status });
  }
}
