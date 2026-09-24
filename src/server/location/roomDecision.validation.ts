import { z } from "zod";
import { decodeDecisionCursor } from "./roomDecisionRepository";

const isoWithTimezone = z.string().trim().refine(value => /(Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)), {
  message: "ISO 8601 tarihi açık bir zaman dilimi içermelidir",
});

const optionalText = z.string().trim().min(1).max(160).optional();

export const roomDecisionQuerySchema = z.object({
  tagCode: optionalText,
  from: isoWithTimezone,
  to: isoWithTimezone,
  mapId: optionalText,
  regionId: optionalText,
  eventType: z.enum(["MEASUREMENT_ACCEPTED", "MEASUREMENT_REJECTED", "ENTRY_CANDIDATE", "ROOM_CONFIRMED", "ROOM_TRANSITIONED", "ROOM_INFERRED", "EXIT_CANDIDATE", "ROOM_EXITED", "LOCATION_LOST", "CONFIG_RELOADED"]).optional(),
  state: z.enum(["TRACKING_OUTSIDE", "ENTRY_CANDIDATE", "IN_REGION", "INFERRED_IN_REGION", "EXIT_CANDIDATE", "LOCATION_LOST"]).optional(),
  measurementKind: z.enum(["measured", "estimated", "uncertain"]).optional(),
  engineVersion: optionalText,
  configVersion: optionalText,
  importantOnly: z.enum(["true", "false"]).transform(value => value === "true").optional(),
  cursor: z.string().trim().min(1).refine(value => decodeDecisionCursor(value) !== null, "Geçersiz cursor").optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
}).strict().refine(value => Date.parse(value.from) <= Date.parse(value.to), {
  message: "Başlangıç zamanı bitiş zamanından sonra olamaz",
  path: ["from"],
});

export function defaultDecisionRange(now = new Date()): { from: string; to: string } {
  return { from: new Date(now.getTime() - 60 * 60 * 1000).toISOString(), to: now.toISOString() };
}
