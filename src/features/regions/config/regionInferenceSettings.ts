import type { DoorInferenceOverrides, DoorInferenceSettings, GlobalRegionEngineSettings, RegionDefinition, ResolvedDoorSettings, ResolvedRoomSettings, RoomInferenceSettings } from "../types/region.types";

export const DEFAULT_DOOR_INFERENCE_SETTINGS: DoorInferenceSettings = Object.freeze({
  enabled: true, direction: "bidirectional", evidenceMode: "preferred",
  entryEvidenceWeight: 1, exitEvidenceWeight: 1, entryConfidenceBonus: 0.25, exitConfidenceBonus: 0,
  crossingValidityMs: 12_000, minimumDirectionalMovementMeters: 0,
  missingDoorEvidenceDurationMultiplier: 1, missingDoorEvidenceCountMultiplier: 1,
  allowEstimatedEntryAfterSignalLoss: true, allowEstimatedExitAfterSignalLoss: true,
});

/** Exact replacements for the former literals in RegionPositionEngine/configLoader. */
export const DEFAULT_REGION_ENGINE_SETTINGS: GlobalRegionEngineSettings = Object.freeze({
  entryEvidenceDurationMs: 1_500, exitEvidenceDurationMs: 1_500,
  entryConfirmationCount: 2, exitConfirmationCount: 2, evidenceWindowMs: 12_000,
  roomSwitchConfirmationCount: 3, roomSwitchEvidenceDurationMs: 1_500,
  roomSwitchUncertainAfterMs: 10_000,
  maxEvidenceGapMs: 4_000, expectedIntervalMs: 1_000,
  relocationEvidenceDurationMultiplier: 2, outsideReleaseDurationMultiplier: 2, exitMarginMeters: 0.5,
  baseScore: 0.15, maximumScore: 0.9, durationContributionMaximum: 0.35,
  durationContributionFullAtMs: 2_100, measurementContributionPerSample: 0.04,
  measurementContributionMaximum: 0.15, doorEntryBonus: 0.25, doorExitBonus: 0,
  confirmedInsideScore: 0.85, inferredInsideMaximumScore: 0.65, invalidMeasurementMaximumScore: 0.5,
  minimumHardwareQuality: 0.25, reliableEvidenceWeight: 0.5, wallEvidenceWeight: 0.1,
  maximumSpeedMetersPerSecond: 4, movementToleranceMeters: 0.25,
  lostAfterMs: 30_000, relocationAfterMs: 15_000,
  regularCoverageStaleMultiplier: 3, intermittentCoverageStaleMultiplier: 5,
  silentCoverageStaleMultiplier: 8, lostAfterStaleMultiplier: 4,
  maxTags: 5_000, historySize: 64, doorDefaults: DEFAULT_DOOR_INFERENCE_SETTINGS,
});

export function resolveGlobalSettings(input?: Partial<GlobalRegionEngineSettings>): GlobalRegionEngineSettings {
  const legacyDuration = input?.evidenceDurationMs;
  const resolved = { ...DEFAULT_REGION_ENGINE_SETTINGS, ...input,
    entryEvidenceDurationMs: input?.entryEvidenceDurationMs ?? legacyDuration ?? DEFAULT_REGION_ENGINE_SETTINGS.entryEvidenceDurationMs,
    exitEvidenceDurationMs: input?.exitEvidenceDurationMs ?? legacyDuration ?? DEFAULT_REGION_ENGINE_SETTINGS.exitEvidenceDurationMs,
  };
  return { ...resolved, doorDefaults: { ...DEFAULT_DOOR_INFERENCE_SETTINGS,
    entryConfidenceBonus: input?.doorDefaults?.entryConfidenceBonus ?? resolved.doorEntryBonus,
    exitConfidenceBonus: input?.doorDefaults?.exitConfidenceBonus ?? resolved.doorExitBonus,
    ...input?.doorDefaults } };
}

export function resolveRoomSettings(globalInput?: Partial<GlobalRegionEngineSettings>, roomInput?: RoomInferenceSettings,
  legacyRoom?: Pick<RegionDefinition, "coverage" | "expectedIntervalMs" | "wallBandMeters" | "sharedWallBandMeters">): ResolvedRoomSettings {
  const global = resolveGlobalSettings(globalInput); const room = roomInput ?? {};
  const { doorDefaults: roomDoors, coverage, wallBandMeters, sharedWallBandMeters, silentEntryMaxDistanceMeters, ...overrides } = room;
  const resolved = { ...global, ...overrides,
    coverage: coverage ?? legacyRoom?.coverage ?? "regular",
    expectedIntervalMs: room.expectedIntervalMs ?? legacyRoom?.expectedIntervalMs ?? global.expectedIntervalMs,
    wallBandMeters: wallBandMeters ?? legacyRoom?.wallBandMeters ?? 0.35,
    sharedWallBandMeters: sharedWallBandMeters ?? legacyRoom?.sharedWallBandMeters ?? 0.65,
    silentEntryMaxDistanceMeters: silentEntryMaxDistanceMeters ?? 0,
  };
  return { ...resolved, doorDefaults: { ...DEFAULT_DOOR_INFERENCE_SETTINGS, ...global.doorDefaults,
    entryConfidenceBonus: roomDoors?.entryConfidenceBonus ?? resolved.doorEntryBonus,
    exitConfidenceBonus: roomDoors?.exitConfidenceBonus ?? resolved.doorExitBonus,
    ...roomDoors } };
}

export function resolveDoorSettings(room: ResolvedRoomSettings, door?: DoorInferenceOverrides): ResolvedDoorSettings {
  return { ...room.doorDefaults, ...door };
}
