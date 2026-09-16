export const DEFAULT_MAP_DISPLAY_CONFIG = { outsideHoldMs: 2_000 } as const;

export function resolveMapDisplayConfig(value: unknown): { outsideHoldMs: number } {
  if (value === undefined) return DEFAULT_MAP_DISPLAY_CONFIG;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Geçersiz mapDisplay ayarı");
  const outsideHoldMs = (value as { outsideHoldMs?: unknown }).outsideHoldMs ?? 2_000;
  if (typeof outsideHoldMs !== "number" || !Number.isInteger(outsideHoldMs) || outsideHoldMs < 0 || outsideHoldMs > 3_600_000) {
    throw new Error("Geçersiz mapDisplay.outsideHoldMs: 0-3600000 aralığında tam sayı zorunlu");
  }
  return { outsideHoldMs };
}
