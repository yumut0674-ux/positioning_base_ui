import type { TrackingPosition } from "../trackingBuffer";
import { createHash } from "node:crypto";
import { crossesDoor, pointInPolygon, wallDistance, type DoorCrossingResult } from "./geometry";
import type { CompiledDoor, CompiledRegion, CompiledRegionsConfig, EvidenceScoreComponents, ProcessedPosition, RegionEngineStatus, SilentDoorProximityCandidate, VehicleRegionStatus } from "./types";

export const ROOM_ENGINE_VERSION = "room-evidence-5";
interface Evidence { at: number; raw: TrackingPosition; room: string | null; weight: number }
type ReliableLocation = { kind: "room"; regionId: string } | { kind: "corridor" } | null;
interface State extends VehicleRegionStatus {
  history: Evidence[]; lastKnown: string | null; reliableRaw: TrackingPosition | null;
  candidateSince: number; crossing: DoorCrossingResult | null; exitCrossing: DoorCrossingResult | null; exitAt: number;
  cadence: number; relocation: boolean; lastSupportAt: number; reasons: string[];
  score: EvidenceScoreComponents; requiredDurationMs: number; requiredMeasurements: number; lastQuality: number | null;
  silentDoorCandidate: SilentDoorProximityCandidate | null; silentDoorInferenceActive: boolean;
  lastReliableLocation: ReliableLocation; dropoutInferenceActive: boolean;
}
const EMPTY_SCORE: EvidenceScoreComponents = { base: 0, duration: 0, measurements: 0, door: 0, total: 0 };

/** Evidence uses measurement time; scheduler only ages existing evidence. */
export class RegionPositionEngine {
  private config: CompiledRegionsConfig | null = null; private enabled = false;
  private scheduler: ReturnType<typeof setInterval> | null = null; private readonly vehicles = new Map<string, State>();
  public constructor(private readonly publish: (position: ProcessedPosition) => void, private readonly broadcastIntervalMs: number,
    private readonly now: () => number = Date.now, private readonly automaticTicks = true) {}
  public enable(config: CompiledRegionsConfig): void { if (this.enabled) return; this.config = config; this.enabled = true; this.vehicles.clear();
    if (this.automaticTicks) { this.scheduler = setInterval(() => this.tick(), this.broadcastIntervalMs); this.scheduler.unref?.(); } }
  public disable(): void { if (this.scheduler) clearInterval(this.scheduler); this.scheduler = null; this.enabled = false; this.config = null; this.vehicles.clear(); }
  public reload(config: CompiledRegionsConfig): void { this.config = config; for (const v of this.vehicles.values()) {
    v.history = []; v.candidateRegionId = null; v.crossing = null; v.exitCrossing = null; v.exitAt = 0;
    v.silentDoorCandidate = null; v.silentDoorInferenceActive = false; v.lastReliableLocation = null; v.dropoutInferenceActive = false;
    if (!config.regions.some(r => r.id === v.activeRegionId)) v.activeRegionId = null;
    v.state = "LOCATION_LOST"; v.relocation = true; v.reasons = ["Harita değişti; yeni ölçüm kanıtı bekleniyor"]; this.send(v, true); } }
  public getVehicleState(id: string): State | undefined { return this.vehicles.get(id); }
  public removeVehicle(id: string): void { this.vehicles.delete(id); }
  public getStatus(rawPort: number, processedPort: number): RegionEngineStatus {
    const config = this.config;
    return { enabled: this.enabled, rawPort, processedPort,
      activeVehicleCount: [...this.vehicles.values()].filter(v => v.state !== "LOCATION_LOST").length,
      vehiclesInRegions: [...this.vehicles.values()].filter(v => v.activeRegionId).length, configLoaded: config !== null,
      configVersion: config?.version,
      diagnostics: [...this.vehicles.values()].map(v => {
        const room = this.region(v.activeRegionId ?? v.candidateRegionId); const crossing = v.exitCrossing ?? v.crossing;
        const door = crossing && room?.entrances.find(d => d.id === crossing.doorId);
        const collectedDurationMs = v.history.length > 1 ? v.history.at(-1)!.at - v.history[0].at : 0;
        return { vehicleId: v.vehicleId, state: v.state, activeRegionId: v.activeRegionId, candidateRegionId: v.candidateRegionId,
          doorId: crossing?.doorId ?? null, doorDirection: crossing?.direction ?? null, doorEvidenceMode: door?.settings.evidenceMode ?? null,
          collectedDurationMs, requiredDurationMs: v.requiredDurationMs, collectedMeasurements: v.insideConfirmationCount || v.exitConfirmationCount,
          requiredMeasurements: v.requiredMeasurements, lastMeasurementQuality: v.lastQuality,
          doorEvidenceRemainingMs: crossing && door ? Math.max(0, door.settings.crossingValidityMs - (this.now() - crossing.occurredAt)) : null,
          silentDoorCandidateRegionId: v.silentDoorCandidate?.regionId ?? null,
          silentDoorCandidateDoorId: v.silentDoorCandidate?.doorId ?? null,
          silentDoorDistanceMeters: v.silentDoorCandidate?.distanceMeters ?? null,
          silentDoorObservedAt: v.silentDoorCandidate?.observedAt ?? null,
          silentDoorCandidateSource: v.silentDoorCandidate?.source ?? null,
          score: v.score, reasons: v.reasons, configVersion: config?.version }; }) };
  }
  private region(id: string | null): CompiledRegion | undefined { return this.config?.regions.find(r => r.id === id); }
  private settings(r?: CompiledRegion) { return r?.settings ?? this.config!.rules; }
  private gap(v: State, r?: CompiledRegion): number { const s = this.settings(r); return Math.max(s.maxEvidenceGapMs, (s.expectedIntervalMs || v.cadence) * 3); }
  private staleAfter(v: State, r?: CompiledRegion): number { const s = this.settings(r); const multiplier = s.coverage === "silent" ? s.silentCoverageStaleMultiplier : s.coverage === "intermittent" ? s.intermittentCoverageStaleMultiplier : s.regularCoverageStaleMultiplier; return Math.max(v.cadence, s.expectedIntervalMs) * multiplier; }
  private lostAfter(v: State, r?: CompiledRegion): number { const s = this.settings(r); return Math.max(s.lostAfterMs, this.staleAfter(v, r) * s.lostAfterStaleMultiplier); }
  private usableDoor(region: CompiledRegion, direction: "entry" | "exit"): CompiledDoor[] { return region.entrances.filter(d => d.settings.enabled && d.settings.evidenceMode !== "ignored" && (d.settings.direction === "bidirectional" || d.settings.direction === `${direction}-only`)); }
  private nearestSilentDoorCandidate(raw: TrackingPosition, observedAt: number): SilentDoorProximityCandidate | null {
    let nearest: SilentDoorProximityCandidate | null = null;
    for (const region of this.config!.regions) {
      if (region.settings.coverage !== "silent" || region.settings.silentEntryMaxDistanceMeters <= 0) continue;
      for (const door of region.entrances) {
        if (!door.settings.enabled || door.settings.direction === "exit-only" || door.settings.evidenceMode === "ignored" || !door.settings.allowEstimatedEntryAfterSignalLoss) continue;
        const distanceMeters = Math.hypot(raw.x - door.x, raw.y - door.y);
        if (distanceMeters <= region.settings.silentEntryMaxDistanceMeters && (!nearest || distanceMeters < nearest.distanceMeters)) {
          nearest = { regionId: region.id, doorId: door.id, distanceMeters, observedAt, source: "silent-door-proximity" };
        }
      }
    }
    return nearest;
  }
  private isCorridorPosition(raw: TrackingPosition): boolean {
    return this.config!.corridors.length === 0 || this.config!.corridors.some(corridor => pointInPolygon(raw, corridor));
  }
  private hasSilentDoorInference(): boolean {
    return this.config!.regions.some(region => region.settings.coverage === "silent" && region.settings.silentEntryMaxDistanceMeters > 0);
  }
  private inferredScore(region: CompiledRegion, evidenceScore = 0): number {
    // Reuse the configured evidence base so a new inference does not inherit an uninitialised zero score.
    return Math.min(region.settings.inferredInsideMaximumScore, Math.max(evidenceScore, region.settings.baseScore));
  }
  private doorPolicy(region: CompiledRegion, direction: "entry" | "exit", crossing: DoorCrossingResult | null) {
    const doors = this.usableDoor(region, direction); const crossed = crossing ? doors.find(d => d.id === crossing.doorId) : undefined;
    const required = doors.some(d => d.settings.evidenceMode === "required");
    if (required && (!crossed || crossed.settings.evidenceMode !== "required")) return { allowed: false, durationMultiplier: 1, countMultiplier: 1, door: crossed };
    if (crossed) return { allowed: true, durationMultiplier: 1, countMultiplier: 1, door: crossed };
    const preferred = doors.find(d => d.settings.evidenceMode === "preferred");
    return { allowed: !required, durationMultiplier: preferred?.settings.missingDoorEvidenceDurationMultiplier ?? 1,
      countMultiplier: preferred?.settings.missingDoorEvidenceCountMultiplier ?? 1, door: undefined };
  }
  private calculateScore(region: CompiledRegion, span: number, count: number, crossing: DoorCrossingResult | null, direction: "entry" | "exit" = "entry"): EvidenceScoreComponents {
    const s = region.settings; const door = crossing && region.entrances.find(d => d.id === crossing.doorId);
    const duration = Math.min(s.durationContributionMaximum, s.durationContributionMaximum * span / Math.max(1, s.durationContributionFullAtMs));
    const measurements = Math.min(s.measurementContributionMaximum, count * s.measurementContributionPerSample);
    const doorScore = crossing ? (direction === "entry" ? door?.settings.entryConfidenceBonus ?? s.doorEntryBonus : door?.settings.exitConfidenceBonus ?? s.doorExitBonus) * crossing.evidenceWeight : 0;
    return { base: s.baseScore, duration, measurements, door: doorScore, total: Math.min(s.maximumScore, s.baseScore + duration + measurements + doorScore) };
  }
  public ingest(raw: TrackingPosition): ProcessedPosition | undefined {
    if (!this.enabled || !this.config) return;
    const at = Date.parse(raw.timestamp), now = this.now(); if (!Number.isFinite(at) || !Number.isFinite(raw.x) || !Number.isFinite(raw.y) || at > now + 2000) return;
    let v = this.vehicles.get(raw.tagCode); if (v && at <= v.lastRawDataTimestamp) return;
    if (!v) { if (this.vehicles.size >= this.config.rules.maxTags) this.vehicles.delete(this.vehicles.keys().next().value!);
      v = { vehicleId: raw.tagCode, state: "TRACKING_OUTSIDE", lastRawPosition: raw, resolvedPosition: undefined as unknown as ProcessedPosition,
        activeRegionId: null, candidateRegionId: null, entryConfidence: 0, lastRawDataTimestamp: at, lastPublishedTimestamp: 0,
        insideConfirmationCount: 0, exitConfirmationCount: 0, history: [], lastKnown: null, reliableRaw: null, candidateSince: at,
        crossing: null, exitCrossing: null, exitAt: 0, cadence: this.config.rules.expectedIntervalMs, relocation: false,
        lastSupportAt: at, reasons: [], score: EMPTY_SCORE, requiredDurationMs: 0, requiredMeasurements: 0, lastQuality: null,
        silentDoorCandidate: null, silentDoorInferenceActive: false, lastReliableLocation: null, dropoutInferenceActive: false };
      this.vehicles.set(raw.tagCode, v); }
    const previous = v.history.at(-1), delta = previous ? at - previous.at : 0; let active = this.region(v.activeRegionId); const activeSettings = this.settings(active);
    const wasInferred = v.state === "INFERRED_IN_REGION";
    const longGap = Boolean(previous && delta >= activeSettings.relocationAfterMs); if (longGap) v.relocation = true;
    if (previous && delta > this.gap(v, active)) { v.history = []; v.candidateRegionId = null; v.crossing = null; v.exitCrossing = null; v.exitAt = 0; }
    if (delta > 0 && delta <= this.gap(v, active)) v.cadence = Math.max(50, v.cadence * 0.8 + delta * 0.2);
    v.lastRawPosition = raw; v.lastRawDataTimestamp = at; v.lastQuality = raw.quality ?? 1;
    const containing = this.config.regions.filter(r => pointInPolygon(raw, r)); const candidate = containing.length === 1 ? containing[0] : undefined;
    const filter = this.settings(candidate ?? active);
    const possible = !previous || longGap || Math.hypot(raw.x - previous.raw.x, raw.y - previous.raw.y) <= filter.maximumSpeedMetersPerSecond * delta / 1000 + filter.movementToleranceMeters;
    const fresh = now - at <= this.gap(v, candidate ?? active), quality = raw.quality ?? 1;
    const nearShared = candidate && this.config.regions.some(r => r.id !== candidate.id && wallDistance(raw, r) < candidate.settings.sharedWallBandMeters);
    const depth = candidate ? wallDistance(raw, candidate) : 0;
    const weight = possible && fresh && quality >= filter.minimumHardwareQuality
      ? (candidate ? (depth > (nearShared ? candidate.settings.sharedWallBandMeters : candidate.settings.wallBandMeters) ? candidate.settings.reliableEvidenceWeight : candidate.settings.wallEvidenceWeight)
        : containing.length === 0 && this.config.regions.every(r => wallDistance(raw, r) > r.settings.wallBandMeters) ? filter.reliableEvidenceWeight : filter.wallEvidenceWeight) * Math.min(1, quality) : 0;
    const reliable = weight >= filter.reliableEvidenceWeight;
    v.history.push({ at, raw, room: candidate?.id ?? null, weight });
    v.history = v.history.filter(e => at - e.at <= filter.evidenceWindowMs).slice(-this.config.rules.historySize); v.reasons = [];
    if (!possible || !fresh || quality < filter.minimumHardwareQuality) { v.state = v.activeRegionId ? "INFERRED_IN_REGION" : "LOCATION_LOST";
      v.entryConfidence = Math.min(v.entryConfidence, filter.invalidMeasurementMaximumScore);
      v.reasons = [!possible ? "Hız sınırını aşan ölçüm kanıt sayılmadı" : !fresh ? "Gecikmiş ölçüm kanıt sayılmadı" : "Düşük donanım kalitesi"]; return this.send(v); }
    if (reliable) {
      if (candidate) {
        v.lastReliableLocation = { kind: "room", regionId: candidate.id };
        v.silentDoorCandidate = null;
      } else if (this.isCorridorPosition(raw)) {
        v.lastReliableLocation = { kind: "corridor" };
        // Corridor-loss inference is intentionally based only on this point-to-door Euclidean distance.
        v.silentDoorCandidate = this.nearestSilentDoorCandidate(raw, at);
      } else {
        v.lastReliableLocation = null; v.silentDoorCandidate = null;
      }
    }
    if (active && candidate?.id === active.id) { v.exitAt = 0; v.exitCrossing = null; v.exitConfirmationCount = 0; v.candidateRegionId = null;
      if (reliable) { v.state = "IN_REGION"; v.lastSupportAt = at; v.reliableRaw = raw; v.entryConfidence = active.settings.confirmedInsideScore; v.relocation = false; v.silentDoorInferenceActive = false; v.dropoutInferenceActive = false; }
      else if (v.silentDoorInferenceActive) { v.state = "INFERRED_IN_REGION"; v.entryConfidence = this.inferredScore(active, v.entryConfidence); }
      else if (at - v.lastSupportAt >= this.lostAfter(v, active)) { v.state = "LOCATION_LOST"; v.relocation = true; }
      else if (at - v.lastSupportAt >= this.staleAfter(v, active)) v.state = "INFERRED_IN_REGION";
      v.reasons = [weight >= active.settings.reliableEvidenceWeight ? "Atanmış odada güvenilir iç ölçüm" : "Duvar bandı ölçümü; önceki oda korunuyor"]; return this.send(v); }
    if (active) {
      if (!v.exitCrossing && previous && previous.weight >= active.settings.reliableEvidenceWeight && at - previous.at <= this.gap(v, active)) v.exitCrossing = crossesDoor(previous.raw, raw, active, false, candidate?.id ?? "corridor", at);
      if (v.exitCrossing && at - v.exitCrossing.occurredAt > (active.entrances.find(d => d.id === v.exitCrossing?.doorId)?.settings.crossingValidityMs ?? active.settings.evidenceWindowMs)) v.exitCrossing = null;
      const policy = this.doorPolicy(active, "exit", v.exitCrossing);
      if (!v.exitAt && (v.exitCrossing || (active.usesDoorPolicy && policy.allowed))) v.exitAt = at;
      if (v.exitAt && at - v.exitAt <= active.settings.evidenceWindowMs && policy.allowed) {
        v.state = "EXIT_CANDIDATE";
        if (wallDistance(raw, active) >= active.settings.exitMarginMeters) v.exitConfirmationCount++;
        v.requiredDurationMs = active.settings.exitEvidenceDurationMs * policy.durationMultiplier;
        v.requiredMeasurements = Math.max(2, Math.ceil(active.settings.exitConfirmationCount * policy.countMultiplier));
        v.score = this.calculateScore(active, at - v.exitAt, v.exitConfirmationCount, v.exitCrossing, "exit");
        if (at - v.exitAt >= v.requiredDurationMs && v.exitConfirmationCount >= v.requiredMeasurements) { v.activeRegionId = null; v.state = "TRACKING_OUTSIDE"; v.history = [v.history.at(-1)!]; v.candidateRegionId = null; v.reasons.push("Çıkış kanıtı ve devam eden dış ölçümlerle çıkış doğrulandı"); }
        else { v.reasons = [v.exitCrossing ? "Kapı çıkışı sonrası süreklilik bekleniyor" : "Tercih edilen kapı görülmedi; artırılmış çıkış kanıtı bekleniyor"]; return this.send(v); }
      } else if (!v.relocation && !(wasInferred && v.dropoutInferenceActive && candidate && reliable)) { v.state = "INFERRED_IN_REGION"; v.candidateRegionId = candidate?.id ?? null;
        v.reasons = [policy.allowed ? "Kapı çıkışı gözlenmedi; kısa komşu oda sıçraması reddedildi" : "Zorunlu kapı çıkışı gözlenmedi"];
        if (at - v.lastSupportAt > this.lostAfter(v, active)) { v.state = "LOCATION_LOST"; v.relocation = true; } return this.send(v); }
    }
    if (!candidate) {
      if (v.activeRegionId && v.relocation) { const outside = v.history.filter(e => e.room === null && e.weight >= filter.reliableEvidenceWeight);
        const duration = activeSettings.exitEvidenceDurationMs * activeSettings.outsideReleaseDurationMultiplier;
        if (outside.length >= Math.max(2, activeSettings.exitConfirmationCount) && outside.at(-1)!.at - outside[0].at >= duration) { v.activeRegionId = null; v.relocation = false; v.reasons.push("Kesinti sonrası tutarlı dış ölçümler; çıkış zamanı bilinmiyor"); } }
      v.candidateRegionId = null; v.crossing = null; if (!v.activeRegionId) { v.state = "TRACKING_OUTSIDE"; v.reliableRaw = raw; v.lastSupportAt = at; v.entryConfidence = 0; }
      const approach = this.config.regions.find(r => r.entrances.some(d => { if (!d.settings.enabled || d.settings.evidenceMode === "ignored" || d.settings.direction === "exit-only" || !d.inwardNormal || !d.widthMeters || !previous) return false;
        const side = (raw.x-d.x)*d.inwardNormal.x+(raw.y-d.y)*d.inwardNormal.y; const before = (previous.raw.x-d.x)*d.inwardNormal.x+(previous.raw.y-d.y)*d.inwardNormal.y;
        const lateral = Math.abs((raw.x-d.x)*-d.inwardNormal.y+(raw.y-d.y)*d.inwardNormal.x); return side<0 && side>-(d.approachDepthMeters??2) && side-before>0.1 && lateral<d.widthMeters/2; }));
      if (approach && !v.activeRegionId) { v.candidateRegionId = approach.id; v.state = "ENTRY_CANDIDATE"; }
      v.reasons.push("Ölçülen koridor konumu; oda giriş kanıtı yok"); return this.send(v);
    }
    if (v.candidateRegionId !== candidate.id) { v.candidateRegionId = candidate.id; v.candidateSince = at; v.crossing = null; }
    // Reliable raw evidence inside a silent room stands on its own; weak wall samples may still use legacy door evidence.
    if (!v.crossing && previous && previous.weight >= candidate.settings.reliableEvidenceWeight && at - previous.at <= this.gap(v, candidate)
      && !(candidate.settings.coverage === "silent" && reliable)) v.crossing = crossesDoor(previous.raw, raw, candidate, true, active?.id ?? "corridor", at);
    if (v.crossing && at - v.crossing.occurredAt > (candidate.entrances.find(d => d.id === v.crossing?.doorId)?.settings.crossingValidityMs ?? candidate.settings.evidenceWindowMs)) v.crossing = null;
    const evidence = v.history.filter(e => e.room === candidate.id && e.at >= v.candidateSince && e.weight >= candidate.settings.reliableEvidenceWeight);
    const span = evidence.length ? evidence.at(-1)!.at - evidence[0].at : 0; v.insideConfirmationCount = evidence.length;
    v.score = this.calculateScore(candidate, span, evidence.length, v.crossing); v.entryConfidence = v.score.total;
    // Required-door policy remains intact elsewhere; reliable silent-room evidence uses only its count and duration.
    const policy = candidate.settings.coverage === "silent"
      ? { allowed: true, durationMultiplier: 1, countMultiplier: 1, door: undefined }
      : this.doorPolicy(candidate, "entry", v.crossing);
    const relocationMultiplier = v.relocation ? candidate.settings.relocationEvidenceDurationMultiplier : 1;
    v.requiredDurationMs = candidate.settings.entryEvidenceDurationMs * relocationMultiplier * policy.durationMultiplier;
    v.requiredMeasurements = Math.max(2, Math.ceil(candidate.settings.entryConfirmationCount * policy.countMultiplier));
    if (policy.allowed && evidence.length >= v.requiredMeasurements && span >= v.requiredDurationMs) { v.activeRegionId = candidate.id; v.lastKnown = candidate.id; v.candidateRegionId = null; v.state = "IN_REGION"; v.lastSupportAt = at; v.reliableRaw = raw; v.entryConfidence = candidate.settings.confirmedInsideScore;
      v.reasons = [candidate.settings.coverage === "silent"
        ? "Sessiz odada sürekli güvenilir iç ölçümler doğrulandı; kapı kanıtı aranmadı."
        : v.relocation ? "Kesinti sonrası tutarlı iç ölçümlerle yeniden konumlandı; geçiş zamanı bilinmiyor"
          : v.crossing ? "Kapı girişi ve sürekli iç ölçümler doğrulandı" : "Kapı geçmişi olmadan sürekli güvenilir iç ölçümler"];
      v.relocation = false; v.silentDoorInferenceActive = false; v.dropoutInferenceActive = false;
    } else { if (!v.activeRegionId) v.state = "ENTRY_CANDIDATE"; v.reasons = [!policy.allowed ? "Zorunlu kapı girişi gözlenmedi" : weight < candidate.settings.reliableEvidenceWeight ? "Duvara yakın ölçüm; güvenilir iç kanıt yetersiz" : "Aday oda için süre ve bağımsız iç ölçümler bekleniyor"]; }
    return this.send(v);
  }
  public tick(): void { if (!this.enabled || !this.config) return; const now = this.now(); for (const [id, v] of this.vehicles) {
    const timeoutRegionId = v.activeRegionId ?? (v.crossing ? v.candidateRegionId : v.silentDoorCandidate?.regionId ?? v.candidateRegionId);
    const age = now - v.lastRawDataTimestamp, r = this.region(timeoutRegionId ?? null); if (age > Math.max(3_600_000, this.lostAfter(v, r) * 10)) { this.vehicles.delete(id); continue; }
    if (now - v.lastPublishedTimestamp < this.broadcastIntervalMs) continue;
    if (age >= this.lostAfter(v, r)) { v.state = "LOCATION_LOST"; v.relocation = true; v.entryConfidence = Math.min(v.entryConfidence, Math.max(0, this.settings(r).invalidMeasurementMaximumScore * (1 - age / (this.lostAfter(v, r) * this.settings(r).lostAfterStaleMultiplier)))); v.reasons = ["Uzun ölçüm kesintisi; güncel konum belirsiz, son bilinen oda korunuyor"]; }
    else if (age >= this.staleAfter(v, r)) { if (v.activeRegionId && r && r.usesDoorPolicy && v.exitCrossing && r.entrances.find(d => d.id === v.exitCrossing?.doorId)?.settings.allowEstimatedExitAfterSignalLoss) { v.activeRegionId = null; v.state = "TRACKING_OUTSIDE"; v.reasons = ["Yönlü kapı çıkışı sonrası ölçüm kesildi; tahmini çıkış uygulandı"]; }
      else if (v.activeRegionId) { v.state = "INFERRED_IN_REGION"; v.dropoutInferenceActive = true; v.entryConfidence = Math.min(v.entryConfidence, this.settings(r).inferredInsideMaximumScore); v.reasons = [r?.settings.coverage === "silent" && v.lastReliableLocation?.kind === "room" && v.lastReliableLocation.regionId === r.id
        ? "Sessiz oda içinde güvenilir ölçüm sonrası sinyal kesildi; son ölçülen oda tahmini korunuyor."
        : v.silentDoorInferenceActive && v.silentDoorCandidate
          ? `Sessiz oda kapısına yakın koridor ölçümü sonrası sinyal kesildi; en yakın kapıya göre tahmini oda atandı (${v.silentDoorCandidate.doorId}, ${v.silentDoorCandidate.distanceMeters.toFixed(2)} m)`
          : "Gerçek ölçüm kesildi; önceki oda tahmini korunuyor"]; }
      else if (r?.settings.coverage === "silent" && v.lastReliableLocation?.kind === "room" && v.lastReliableLocation.regionId === r.id) {
        // One trustworthy in-room sample is enough to retain a bounded estimate during a silent-room dropout.
        v.activeRegionId = r.id; v.lastKnown = r.id; v.state = "INFERRED_IN_REGION";
        v.dropoutInferenceActive = true;
        v.entryConfidence = this.inferredScore(r, v.entryConfidence);
        v.reasons = ["Sessiz oda içinde güvenilir ölçüm sonrası sinyal kesildi; son ölçülen oda tahmini korunuyor."];
      }
      else if (r && v.crossing && v.lastRawDataTimestamp - v.crossing.occurredAt <= this.gap(v, r)) {
        const door = r.entrances.find(d => d.id === v.crossing?.doorId);
        const hasReliableInsideMeasurement = v.history.some(e => e.room === r.id && e.weight >= r.settings.reliableEvidenceWeight && e.at >= v.crossing!.occurredAt);
        const isConcreteRoomDoorEntry = r.settings.coverage === "silent" && door?.settings.evidenceMode === "required";
        if (door?.settings.allowEstimatedEntryAfterSignalLoss && (hasReliableInsideMeasurement || isConcreteRoomDoorEntry)) {
          v.activeRegionId = r.id; v.lastKnown = r.id; v.state = "INFERRED_IN_REGION";
          v.dropoutInferenceActive = true;
          v.reasons = [isConcreteRoomDoorEntry && !hasReliableInsideMeasurement
            ? "Beton oda kapısından yönlü geçiş sonrası sinyal kesildi; tahmini oda"
            : "Yönlü kapı geçişi ve iç ölçüm sonrası kesinti; tahmini oda"];
        }
      }
      if (!v.activeRegionId && v.lastReliableLocation?.kind === "corridor" && v.silentDoorCandidate) {
        const inferred = this.region(v.silentDoorCandidate.regionId);
        if (inferred) {
          v.activeRegionId = inferred.id; v.lastKnown = inferred.id; v.candidateRegionId = null; v.crossing = null;
          v.silentDoorInferenceActive = true; v.dropoutInferenceActive = true; v.state = "INFERRED_IN_REGION";
          v.entryConfidence = this.inferredScore(inferred);
          v.reasons = [`Sessiz oda kapısına yakın koridor ölçümü sonrası sinyal kesildi; en yakın kapıya göre tahmini oda atandı (${v.silentDoorCandidate.doorId}, ${v.silentDoorCandidate.distanceMeters.toFixed(2)} m)`];
        }
      }
      if (!v.activeRegionId && v.lastReliableLocation?.kind === "corridor" && this.hasSilentDoorInference()) { v.candidateRegionId = null; v.state = "LOCATION_LOST"; v.reasons = ["Son güvenilir koridor ölçümü uygun sessiz oda kapısına yakın değil; güncel konum belirsiz"]; }
      else if (!v.activeRegionId && !v.candidateRegionId) { v.state = "LOCATION_LOST"; v.reasons = ["Kesinti giriş kanıtı değildir; güncel konum belirsiz"]; } }
    else continue; this.send(v, true); } }
  private send(v: State, synthetic = false): ProcessedPosition { const r = this.region(v.activeRegionId), raw = v.lastRawPosition;
    const kind = v.state === "IN_REGION" || v.state === "TRACKING_OUTSIDE" ? "measured" : v.state === "INFERRED_IN_REGION" || v.state === "EXIT_CANDIDATE" ? "estimated" : "uncertain";
    const position: ProcessedPosition = { ...raw, x: r?.roomCenter.x ?? raw.x, y: r?.roomCenter.y ?? raw.y,
      decisionId: createHash("sha256").update(JSON.stringify([v.vehicleId, raw.timestamp, this.now(), v.state, v.activeRegionId, v.candidateRegionId, this.config?.version])).digest("hex"),
      timestamp: raw.timestamp, publishedAt: new Date(this.now()).toISOString(), synthetic, engineVersion: ROOM_ENGINE_VERSION, configVersion: this.config?.version ?? "unversioned",
      positionSource: r ? "REGION_CENTER" : "RAW", rawPosition: raw, lastRawDataTimestamp: raw.timestamp,
      regionInference: { enabled: true, state: v.state, regionId: v.state === "LOCATION_LOST" ? null : v.activeRegionId,
        regionName: v.state === "LOCATION_LOST" ? null : r?.name ?? null, candidateRegionId: v.candidateRegionId, lastKnownRegionId: v.lastKnown,
        confidence: v.entryConfidence, reasons: v.reasons, measurementKind: kind,
        uncertainAfter: new Date(v.lastRawDataTimestamp + this.lostAfter(v, r)).toISOString(), validUntil: new Date(v.lastRawDataTimestamp + this.staleAfter(v, r)).toISOString() } };
    v.resolvedPosition = position; v.lastPublishedTimestamp = this.now(); this.publish(position); return position; }
}
