export const MAX_POSITION_PDOP = 20;

export interface PdopFilterSettings {
  readonly enabled: boolean;
  readonly maximumPdop: number;
}

export const DEFAULT_PDOP_FILTER_SETTINGS: PdopFilterSettings = Object.freeze({ enabled: true, maximumPdop: MAX_POSITION_PDOP });

export function parsePdopFilterSettings(value: unknown): PdopFilterSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PDOP filtre ayarları bir nesne olmalıdır");
  const settings = value as Record<string, unknown>;
  if (Object.keys(settings).some(key => key !== "enabled" && key !== "maximumPdop")) throw new Error("PDOP filtre ayarlarında bilinmeyen alan var");
  if (typeof settings.enabled !== "boolean") throw new Error("PDOP filtresi enabled değeri boolean olmalıdır");
  if (typeof settings.maximumPdop !== "number" || !Number.isFinite(settings.maximumPdop) || settings.maximumPdop < 0) {
    throw new Error("PDOP üst sınırı sıfır veya daha büyük sonlu bir sayı olmalıdır");
  }
  return { enabled: settings.enabled, maximumPdop: settings.maximumPdop };
}

/** Unknown geometry quality passes. Disabling the threshold still rejects non-finite data. */
export function isPositionPdopAccepted(pdop: number | null | undefined, settings = DEFAULT_PDOP_FILTER_SETTINGS): boolean {
  return pdop == null || (Number.isFinite(pdop) && (!settings.enabled || pdop <= settings.maximumPdop));
}
