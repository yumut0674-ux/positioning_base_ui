import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { LocationError, statusForError, toErrorEnvelope } from "./locationErrors";

export async function locationRoute(handler: () => Promise<unknown>): Promise<NextResponse> {
  try {
    return NextResponse.json(await handler());
  } catch (error) {
    const safeError = error instanceof ZodError
      ? new LocationError("VALIDATION_ERROR", { details: { fields: error.issues.map((issue) => issue.path.join(".")) } })
      : error;
    return NextResponse.json(toErrorEnvelope(safeError), { status: statusForError(safeError) });
  }
}
