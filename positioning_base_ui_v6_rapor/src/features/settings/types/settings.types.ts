import { z } from "zod";

const reportDuration = z.number().int().min(0).max(86_400_000).multipleOf(1_000);
// Read old settings without rewriting the file or changing any tracking settings.
const reportSettingsSchema = z.object({
  routeHistoryMinDurationMs: reportDuration.optional(),
  routeHistoryRoomMinDurationMs: reportDuration.optional(),
  routeHistoryCorridorMinDurationMs: reportDuration.optional(),
}).strict().transform(value => ({
  routeHistoryRoomMinDurationMs: value.routeHistoryRoomMinDurationMs ?? value.routeHistoryMinDurationMs ?? 60_000,
  routeHistoryCorridorMinDurationMs: value.routeHistoryCorridorMinDurationMs ?? value.routeHistoryMinDurationMs ?? 60_000,
})).default({ routeHistoryRoomMinDurationMs: 60_000, routeHistoryCorridorMinDurationMs: 60_000 });

// Add future categories here; each category owns its validation and editor.
export const systemSettingsSchema = z.object({
  version: z.literal(1),
  tracking: z.object({
    noDataHideAfterMs: z.number().int().min(1_000).max(86_400_000).multipleOf(1_000),
  }).strict(),
  reports: reportSettingsSchema,
  notifications: z.object({
    exitDelayMs: z.number().int().min(0).max(86_400_000).multipleOf(1_000),
    displayDurationMs: z.number().int().min(1_000).max(86_400_000).multipleOf(1_000),
  }).strict().default({ exitDelayMs: 5_000, displayDurationMs: 10_000 }),
}).strict();

export type SystemSettings = z.infer<typeof systemSettingsSchema>;
export type ReportDurationSettings = SystemSettings["reports"];
export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  version: 1,
  tracking: { noDataHideAfterMs: 60_000 },
  reports: { routeHistoryRoomMinDurationMs: 60_000, routeHistoryCorridorMinDurationMs: 60_000 },
  notifications: { exitDelayMs: 5_000, displayDurationMs: 10_000 },
};

export interface SystemSettingsResponse {
  readonly settings: SystemSettings;
  readonly defaults: SystemSettings;
}
