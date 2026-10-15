import { z } from "zod";

// Add future categories here; each category owns its validation and editor.
export const systemSettingsSchema = z.object({
  version: z.literal(1),
  tracking: z.object({
    noDataHideAfterMs: z.number().int().min(1_000).max(86_400_000).multipleOf(1_000),
  }).strict(),
}).strict();

export type SystemSettings = z.infer<typeof systemSettingsSchema>;
export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  version: 1,
  tracking: { noDataHideAfterMs: 60_000 },
};

export interface SystemSettingsResponse {
  readonly settings: SystemSettings;
  readonly defaults: SystemSettings;
}
