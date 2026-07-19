import { z } from "zod";

const isoWithTimezone = z.string().trim().refine((value) => {
  const hasTimezone = /(Z|[+-]\d{2}:\d{2})$/i.test(value);
  return hasTimezone && Number.isFinite(Date.parse(value));
}, "ISO 8601 tarihi açık bir zaman dilimi içermelidir");

export const searchEntitiesInputSchema = z.object({
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(20).default(10),
}).strict();

export const currentLocationInputSchema = z.object({
  entityId: z.number().int().positive(),
}).strict();

export const locationAtTimeInputSchema = z.object({
  entityId: z.number().int().positive(),
  at: isoWithTimezone,
  toleranceSeconds: z.number().int().min(1).max(86_400).default(300),
}).strict();

export const locationHistoryInputSchema = z.object({
  entityId: z.number().int().positive(),
  from: isoWithTimezone,
  to: isoWithTimezone,
  format: z.enum(["zone_timeline", "route_points"]),
  limit: z.number().int().min(1).max(2_000).default(2_000),
}).strict();

export type SearchEntitiesInput = z.infer<typeof searchEntitiesInputSchema>;
export type CurrentLocationInput = z.infer<typeof currentLocationInputSchema>;
export type LocationAtTimeInput = z.infer<typeof locationAtTimeInputSchema>;
export type LocationHistoryInput = z.infer<typeof locationHistoryInputSchema>;
