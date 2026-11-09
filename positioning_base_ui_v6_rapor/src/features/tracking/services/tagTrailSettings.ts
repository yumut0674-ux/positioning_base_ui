export interface TagTrailSettings {
  readonly enabled: boolean;
  readonly durationMs: number;
}

export const TAG_TRAIL_STORAGE_KEY = "ips-tag-trail-settings";
export const TAG_TRAIL_MIN_DURATION_MS = 1_000;
export const TAG_TRAIL_MAX_DURATION_MS = 15_000;
export const TAG_TRAIL_DURATION_STEP_MS = 1_000;

export const DEFAULT_TAG_TRAIL_SETTINGS: TagTrailSettings = {
  enabled: true,
  durationMs: 5_000,
};

interface StorageReader {
  getItem(key: string): string | null;
}

interface StorageWriter {
  setItem(key: string, value: string): void;
}

export function normalizeTagTrailDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs)) return DEFAULT_TAG_TRAIL_SETTINGS.durationMs;
  const bounded = Math.min(TAG_TRAIL_MAX_DURATION_MS, Math.max(TAG_TRAIL_MIN_DURATION_MS, durationMs));
  return Math.round(bounded / TAG_TRAIL_DURATION_STEP_MS) * TAG_TRAIL_DURATION_STEP_MS;
}

export function resolveTagTrailSettings(value: unknown): TagTrailSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_TAG_TRAIL_SETTINGS;
  const input = value as Partial<TagTrailSettings>;
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : DEFAULT_TAG_TRAIL_SETTINGS.enabled,
    durationMs: typeof input.durationMs === "number"
      ? normalizeTagTrailDuration(input.durationMs)
      : DEFAULT_TAG_TRAIL_SETTINGS.durationMs,
  };
}

export function readTagTrailSettings(storage: StorageReader): TagTrailSettings {
  try {
    const stored = storage.getItem(TAG_TRAIL_STORAGE_KEY);
    return stored ? resolveTagTrailSettings(JSON.parse(stored)) : DEFAULT_TAG_TRAIL_SETTINGS;
  } catch {
    return DEFAULT_TAG_TRAIL_SETTINGS;
  }
}

export function persistTagTrailSettings(storage: StorageWriter, settings: TagTrailSettings): void {
  storage.setItem(TAG_TRAIL_STORAGE_KEY, JSON.stringify(resolveTagTrailSettings(settings)));
}
