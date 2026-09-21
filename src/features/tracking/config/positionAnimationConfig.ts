import type { PositionAnimationConfig } from "../types/tracking.types";

export const DEFAULT_POSITION_ANIMATION_CONFIG: PositionAnimationConfig = {
  enabled: true,
  mode: "buffered_interpolation",
  interpolationDelayMs: 4_500, // Biraz daha fazla gecikme pahasina paket dalgalanmalarini gorunur harekete donusturmez.
  maximumBufferSize: 16,
  maximumSegmentDurationMs: 2_500,
  maximumExtrapolationMs: 0,
  stalePositionTimeoutMs: 4_000,
  teleportDistanceMeters: 6,
  teleportAnimationDurationMs: 1_500,
  regionTransitionDurationMs: 2_000,
  maximumVisualSpeedMetersPerSecond: 1.2,
  maximumTransitionDurationMs: 8_000,
  easing: "ease_in_out",
};

export const POSITION_ANIMATION_CONFIG_CHANGED_EVENT = "position-animation-config-changed";

function finiteInRange(
  value: unknown,
  fallback: number,
  field: string,
  minimum: number,
  maximum: number,
  integer = true,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw new Error(`positionAnimation.${field} ${minimum}-${maximum} aralığında ${integer ? "bir tam sayı" : "bir sayı"} olmalıdır`);
  }
  return value;
}

export function resolvePositionAnimationConfig(value: unknown): PositionAnimationConfig {
  if (value === undefined) return DEFAULT_POSITION_ANIMATION_CONFIG;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("positionAnimation bir nesne olmalıdır");
  }
  const input = value as Partial<PositionAnimationConfig>;
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    throw new Error("positionAnimation.enabled boolean olmalıdır");
  }
  if (input.mode !== undefined && input.mode !== "buffered_interpolation") {
    throw new Error('positionAnimation.mode "buffered_interpolation" olmalıdır');
  }
  if (input.easing !== undefined && input.easing !== "linear" && input.easing !== "ease_in_out") {
    throw new Error('positionAnimation.easing "linear" veya "ease_in_out" olmalıdır');
  }

  return {
    enabled: input.enabled ?? DEFAULT_POSITION_ANIMATION_CONFIG.enabled,
    mode: input.mode ?? DEFAULT_POSITION_ANIMATION_CONFIG.mode,
    interpolationDelayMs: finiteInRange(input.interpolationDelayMs, DEFAULT_POSITION_ANIMATION_CONFIG.interpolationDelayMs, "interpolationDelayMs", 0, 60_000),
    maximumBufferSize: finiteInRange(input.maximumBufferSize, DEFAULT_POSITION_ANIMATION_CONFIG.maximumBufferSize, "maximumBufferSize", 2, 1_000),
    maximumSegmentDurationMs: finiteInRange(input.maximumSegmentDurationMs, DEFAULT_POSITION_ANIMATION_CONFIG.maximumSegmentDurationMs, "maximumSegmentDurationMs", 1, 60_000),
    maximumExtrapolationMs: finiteInRange(input.maximumExtrapolationMs, DEFAULT_POSITION_ANIMATION_CONFIG.maximumExtrapolationMs, "maximumExtrapolationMs", 0, 10_000),
    stalePositionTimeoutMs: finiteInRange(input.stalePositionTimeoutMs, DEFAULT_POSITION_ANIMATION_CONFIG.stalePositionTimeoutMs, "stalePositionTimeoutMs", 1, 3_600_000),
    teleportDistanceMeters: finiteInRange(input.teleportDistanceMeters, DEFAULT_POSITION_ANIMATION_CONFIG.teleportDistanceMeters, "teleportDistanceMeters", 0, 100_000, false),
    teleportAnimationDurationMs: finiteInRange(input.teleportAnimationDurationMs, DEFAULT_POSITION_ANIMATION_CONFIG.teleportAnimationDurationMs, "teleportAnimationDurationMs", 0, 60_000),
    regionTransitionDurationMs: finiteInRange(input.regionTransitionDurationMs, DEFAULT_POSITION_ANIMATION_CONFIG.regionTransitionDurationMs, "regionTransitionDurationMs", 0, 60_000),
    maximumVisualSpeedMetersPerSecond: finiteInRange(input.maximumVisualSpeedMetersPerSecond, DEFAULT_POSITION_ANIMATION_CONFIG.maximumVisualSpeedMetersPerSecond, "maximumVisualSpeedMetersPerSecond", 0.05, 100, false),
    maximumTransitionDurationMs: finiteInRange(input.maximumTransitionDurationMs, DEFAULT_POSITION_ANIMATION_CONFIG.maximumTransitionDurationMs, "maximumTransitionDurationMs", 1, 60_000),
    easing: input.easing ?? DEFAULT_POSITION_ANIMATION_CONFIG.easing,
  };
}
