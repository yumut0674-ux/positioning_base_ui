export interface RegionEngineRuntimeConfig {
  readonly rawPort: number;
  readonly processedPort: number;
  readonly broadcastIntervalMs: number;
  readonly allowedOrigin: string;
}

declare const __RAW_POSITION_PORT__: string | undefined;
declare const __REGION_POSITION_PORT__: string | undefined;
declare const __REGION_BROADCAST_INTERVAL_MS__: string | undefined;
declare const __REGION_POSITION_ALLOWED_ORIGIN__: string | undefined;

const bundled = {
  rawPort: typeof __RAW_POSITION_PORT__ === "undefined" ? undefined : __RAW_POSITION_PORT__,
  processedPort: typeof __REGION_POSITION_PORT__ === "undefined" ? undefined : __REGION_POSITION_PORT__,
  interval: typeof __REGION_BROADCAST_INTERVAL_MS__ === "undefined" ? undefined : __REGION_BROADCAST_INTERVAL_MS__,
  allowedOrigin: typeof __REGION_POSITION_ALLOWED_ORIGIN__ === "undefined" ? undefined : __REGION_POSITION_ALLOWED_ORIGIN__,
};

function readInteger(name: string, fallback: number, minimum: number, maximum: number, bundledValue?: string): number {
  const raw = bundledValue || process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} ${minimum}-${maximum} aralığında bir tam sayı olmalıdır`);
  }
  return value;
}

export function getRegionEngineRuntimeConfig(): RegionEngineRuntimeConfig {
  const rawPort = readInteger("RAW_POSITION_PORT", Number(process.env.PORT) || 3000, 1, 65_535, bundled.rawPort);
  const processedPort = readInteger("REGION_POSITION_PORT", 3001, 1, 65_535, bundled.processedPort);
  if (rawPort === processedPort) {
    throw new Error("REGION_POSITION_PORT, RAW_POSITION_PORT ile aynı olamaz");
  }
  return {
    rawPort,
    processedPort,
    broadcastIntervalMs: readInteger("REGION_BROADCAST_INTERVAL_MS", 1_000, 100, 60_000, bundled.interval),
    allowedOrigin: bundled.allowedOrigin?.trim() || process.env.REGION_POSITION_ALLOWED_ORIGIN?.trim() || "*",
  };
}
