import type { TrackingPosition } from "../trackingBuffer";
import { createHash } from "node:crypto";
import { crossesDoor, pointInPolygon, wallDistance } from "./geometry";
import type { CompiledRegion, CompiledRegionsConfig, ProcessedPosition, RegionEngineStatus, VehicleRegionStatus } from "./types";

export const ROOM_ENGINE_VERSION = "room-evidence-2";
interface Evidence { at: number; raw: TrackingPosition; room: string | null; weight: number }
interface State extends VehicleRegionStatus {
  history: Evidence[]; lastKnown: string | null; reliableRaw: TrackingPosition | null;
  candidateSince: number; crossingAt: number; exitAt: number; cadence: number;
  relocation: boolean; lastSupportAt: number; reasons: string[];
}

/** Evidence uses measurement time; scheduler only ages existing evidence. */
export class RegionPositionEngine {
  private config: CompiledRegionsConfig | null = null;
  private enabled = false;
  private scheduler: ReturnType<typeof setInterval> | null = null;
  private readonly vehicles = new Map<string, State>();
  public constructor(private readonly publish: (position: ProcessedPosition) => void, private readonly broadcastIntervalMs: number, private readonly now: () => number = Date.now, private readonly automaticTicks = true) {}
  public enable(config: CompiledRegionsConfig): void {
    if (this.enabled) return;
    this.config = config; this.enabled = true; this.vehicles.clear();
    if (this.automaticTicks) { this.scheduler = setInterval(() => this.tick(), this.broadcastIntervalMs); this.scheduler.unref?.(); }
  }
  public disable(): void {
    if (this.scheduler) clearInterval(this.scheduler);
    this.scheduler = null; this.enabled = false; this.config = null; this.vehicles.clear();
  }
  public reload(config: CompiledRegionsConfig): void {
    this.config = config;
    for (const v of this.vehicles.values()) {
      v.history = []; v.candidateRegionId = null; v.crossingAt = 0; v.exitAt = 0;
      if (!config.regions.some(r => r.id === v.activeRegionId)) v.activeRegionId = null;
      v.state = "LOCATION_LOST"; v.relocation = true; v.reasons = ["Harita değişti; yeni ölçüm kanıtı bekleniyor"];
      this.send(v, true);
    }
  }
  public getVehicleState(id: string): State | undefined { return this.vehicles.get(id); }
  public getStatus(rawPort: number, processedPort: number): RegionEngineStatus {
    return { enabled: this.enabled, rawPort, processedPort, activeVehicleCount: [...this.vehicles.values()].filter(v => v.state !== "LOCATION_LOST").length,
      vehiclesInRegions: [...this.vehicles.values()].filter(v => v.activeRegionId).length, configLoaded: this.config !== null };
  }
  private region(id: string | null): CompiledRegion | undefined { return this.config?.regions.find(r => r.id === id); }
  private gap(v: State, r?: CompiledRegion): number { return Math.max(this.config!.rules.maxEvidenceGapMs ?? 4000, (r?.expectedIntervalMs ?? v.cadence) * 3); }
  private staleAfter(v: State, r?: CompiledRegion): number { return Math.max(v.cadence, r?.expectedIntervalMs ?? 0) * (r?.coverage === "silent" ? 8 : r?.coverage === "intermittent" ? 5 : 3); }
  private lostAfter(v: State, r?: CompiledRegion): number { return Math.max(this.config!.rules.lostAfterMs ?? 30000, this.staleAfter(v, r) * 4); }
  public ingest(raw: TrackingPosition): ProcessedPosition | undefined {
    if (!this.enabled || !this.config) return;
    const at = Date.parse(raw.timestamp), now = this.now();
    if (!Number.isFinite(at) || !Number.isFinite(raw.x) || !Number.isFinite(raw.y) || at > now + 2000) return;
    let v = this.vehicles.get(raw.tagCode);
    if (v && at <= v.lastRawDataTimestamp) return;
    if (!v) {
      if (this.vehicles.size >= (this.config.rules.maxTags ?? 5000)) this.vehicles.delete(this.vehicles.keys().next().value!);
      v = { vehicleId: raw.tagCode, state: "TRACKING_OUTSIDE", lastRawPosition: raw, resolvedPosition: undefined as unknown as ProcessedPosition,
        activeRegionId: null, candidateRegionId: null, entryConfidence: 0, lastRawDataTimestamp: at, lastPublishedTimestamp: 0,
        insideConfirmationCount: 0, exitConfirmationCount: 0, history: [], lastKnown: null, reliableRaw: null, candidateSince: at,
        crossingAt: 0, exitAt: 0, cadence: this.config.rules.expectedIntervalMs ?? 1000, relocation: false, lastSupportAt: at, reasons: [] };
      this.vehicles.set(raw.tagCode, v);
    }
    const previous = v.history.at(-1), delta = previous ? at - previous.at : 0;
    const active = this.region(v.activeRegionId);
    const longGap = previous && delta >= (this.config.rules.relocationAfterMs ?? 15000);
    if (longGap) v.relocation = true;
    if (previous && delta > this.gap(v, active)) { v.history = []; v.candidateRegionId = null; v.crossingAt = 0; v.exitAt = 0; }
    if (delta > 0 && delta <= this.gap(v, active)) v.cadence = Math.max(50, v.cadence * 0.8 + delta * 0.2);
    v.lastRawPosition = raw; v.lastRawDataTimestamp = at;
    const possible = !previous || longGap || Math.hypot(raw.x - previous.raw.x, raw.y - previous.raw.y) <= (this.config.rules.maxSpeedMetersPerSecond ?? 4) * delta / 1000 + 0.25;
    const fresh = now - at <= this.gap(v, active), quality = raw.quality ?? 1;
    const containing = this.config.regions.filter(r => pointInPolygon(raw, r));
    const candidate = containing.length === 1 ? containing[0] : undefined;
    const nearShared = candidate && this.config.regions.some(r => r.id !== candidate.id && wallDistance(raw, r) < (candidate.sharedWallBandMeters ?? 0.65));
    const depth = candidate ? wallDistance(raw, candidate) : 0;
    const weight = possible && fresh && quality >= 0.25
      ? (candidate ? (depth > (nearShared ? candidate.sharedWallBandMeters ?? 0.65 : candidate.wallBandMeters ?? 0.35) ? 1 : 0.1)
        : containing.length === 0 && this.config.regions.every(r => wallDistance(raw,r) > (r.wallBandMeters ?? 0.35)) ? 1 : 0.1) * Math.min(1, quality) : 0;
    v.history.push({ at, raw, room: candidate?.id ?? null, weight });
    v.history = v.history.filter(e => at - e.at <= (this.config!.rules.evidenceWindowMs ?? 12000)).slice(-(this.config.rules.historySize ?? 64));
    v.reasons = [];
    if (!possible || !fresh || quality < 0.25) {
      v.state = v.activeRegionId ? "INFERRED_IN_REGION" : "LOCATION_LOST";
      v.entryConfidence = Math.min(v.entryConfidence,0.5);
      v.reasons = [!possible ? "Hız sınırını aşan ölçüm kanıt sayılmadı" : !fresh ? "Gecikmiş ölçüm kanıt sayılmadı" : "Düşük donanım kalitesi"];
      return this.send(v);
    }
    if (active && candidate?.id === active.id) {
      v.exitAt = 0; v.exitConfirmationCount = 0; v.candidateRegionId = null;
      if (weight >= 0.5) { v.state = "IN_REGION"; v.lastSupportAt = at; v.reliableRaw = raw; v.entryConfidence = 0.85; v.relocation = false; }
      else if (at - v.lastSupportAt >= this.lostAfter(v, active)) { v.state = "LOCATION_LOST"; v.relocation = true; }
      else if (at - v.lastSupportAt >= this.staleAfter(v, active)) v.state = "INFERRED_IN_REGION";
      v.reasons = [weight >= 0.5 ? "Atanmış odada güvenilir iç ölçüm" : "Duvar bandı ölçümü; önceki oda korunuyor"];
      return this.send(v);
    }
    if (active) {
      if (!v.exitAt && v.history.some(e => e.weight >= 0.5 && e.at < at && at-e.at <= this.gap(v, active) && crossesDoor(e.raw, raw, active, false, candidate?.id ?? "corridor"))) v.exitAt = at;
      if (v.exitAt && at - v.exitAt <= (this.config.rules.evidenceWindowMs ?? 12000)) {
        v.state = "EXIT_CANDIDATE"; v.exitConfirmationCount++;
        if (at - v.exitAt >= (this.config.rules.evidenceDurationMs ?? 1500) && v.exitConfirmationCount >= Math.max(2, this.config.rules.exitConfirmationCount)) {
          v.activeRegionId = null; v.state = "TRACKING_OUTSIDE"; v.history = [v.history.at(-1)!]; v.candidateRegionId = null;
          v.reasons.push("Kapıdan dışa geçiş ve devam eden dış ölçümlerle çıkış doğrulandı");
        } else { v.reasons = ["Kapı çıkışı sonrası süreklilik bekleniyor"]; return this.send(v); }
      } else if (!v.relocation) {
        v.state = "INFERRED_IN_REGION";
        v.candidateRegionId = candidate?.id ?? null;
        v.reasons = ["Kapı çıkışı gözlenmedi; kısa komşu oda sıçraması reddedildi"];
        if (at - v.lastSupportAt > this.lostAfter(v, active)) { v.state = "LOCATION_LOST"; v.relocation = true; }
        return this.send(v);
      }
    }
    if (!candidate) {
      if (v.activeRegionId && v.relocation) {
        const outside = v.history.filter(e=>e.room===null&&e.weight>=0.5);
        if (outside.length >= Math.max(2,this.config.rules.exitConfirmationCount) && outside.at(-1)!.at-outside[0].at >= (this.config.rules.evidenceDurationMs??1500)*2) {
          v.activeRegionId=null; v.relocation=false; v.reasons.push("Kesinti sonrası tutarlı dış ölçümler; çıkış zamanı bilinmiyor");
        }
      }
      v.candidateRegionId = null; v.crossingAt = 0;
      if (!v.activeRegionId) { v.state = "TRACKING_OUTSIDE"; v.reliableRaw = raw; v.lastSupportAt=at; v.entryConfidence=0; }
      const approach = this.config.regions.find(r => r.entrances.some(d => {
        if (!d.inwardNormal || !d.widthMeters || !previous) return false;
        const side = (raw.x-d.x)*d.inwardNormal.x+(raw.y-d.y)*d.inwardNormal.y;
        const before = (previous.raw.x-d.x)*d.inwardNormal.x+(previous.raw.y-d.y)*d.inwardNormal.y;
        const lateral = Math.abs((raw.x-d.x)*-d.inwardNormal.y+(raw.y-d.y)*d.inwardNormal.x);
        return side<0 && side>-(d.approachDepthMeters??2) && side-before>0.1 && lateral<d.widthMeters/2;
      }));
      if (approach && !v.activeRegionId) { v.candidateRegionId = approach.id; v.state = "ENTRY_CANDIDATE"; }
      v.reasons.push("Ölçülen koridor konumu; oda giriş kanıtı yok");
      return this.send(v);
    }
    if (v.candidateRegionId !== candidate.id) { v.candidateRegionId = candidate.id; v.candidateSince = at; v.crossingAt = 0; }
    if (!v.crossingAt && v.history.some(e => e.weight >= 0.5 && e.at < at && at-e.at <= this.gap(v, candidate) && crossesDoor(e.raw, raw, candidate, true, active?.id ?? "corridor"))) v.crossingAt = at;
    const evidence = v.history.filter(e => e.room === candidate.id && e.at >= v.candidateSince && e.weight >= 0.5);
    const span = evidence.length ? evidence.at(-1)!.at - evidence[0].at : 0;
    v.insideConfirmationCount = evidence.length;
    // Uncalibrated evidence score, not a probability.
    v.entryConfidence = Math.min(0.9, 0.15 + Math.min(0.35, span / 6000) + (v.crossingAt ? 0.25 : 0) + Math.min(0.15, evidence.reduce((s, e) => s + e.weight, 0) * 0.04));
    const duration = (this.config.rules.evidenceDurationMs ?? 1500) * (v.relocation ? 2 : 1);
    if (evidence.length >= Math.max(2, this.config.rules.entryConfirmationCount) && span >= duration) {
      v.activeRegionId = candidate.id; v.lastKnown = candidate.id; v.candidateRegionId = null; v.state = "IN_REGION";
      v.lastSupportAt = at; v.reliableRaw = raw;
      v.reasons = [v.relocation ? "Kesinti sonrası tutarlı iç ölçümlerle yeniden konumlandı; geçiş zamanı bilinmiyor" : v.crossingAt ? "Kapı girişi ve sürekli iç ölçümler doğrulandı" : "Kapı geçmişi olmadan sürekli güvenilir iç ölçümler"];
      v.relocation = false;
    } else {
      if (!v.activeRegionId) v.state = "ENTRY_CANDIDATE";
      v.reasons = [weight < 0.5 ? "Duvara yakın ölçüm; güvenilir iç kanıt yetersiz" : "Aday oda için süre ve bağımsız iç ölçümler bekleniyor"];
    }
    return this.send(v);
  }
  public tick(): void {
    if (!this.enabled || !this.config) return;
    const now = this.now();
    for (const [id, v] of this.vehicles) {
      const age = now - v.lastRawDataTimestamp, r = this.region(v.activeRegionId ?? v.candidateRegionId);
      if (age > Math.max(3600000, this.lostAfter(v, r) * 10)) { this.vehicles.delete(id); continue; }
      if (now - v.lastPublishedTimestamp < this.broadcastIntervalMs) continue;
      if (age >= this.lostAfter(v, r)) {
        v.state = "LOCATION_LOST"; v.relocation = true; v.entryConfidence = Math.min(v.entryConfidence,Math.max(0, 0.5 * (1 - age / (this.lostAfter(v, r) * 4))));
        v.reasons = ["Uzun ölçüm kesintisi; güncel konum belirsiz, son bilinen oda korunuyor"];
      } else if (age >= this.staleAfter(v, r)) {
        if (v.activeRegionId) { v.state = "INFERRED_IN_REGION"; v.entryConfidence = Math.min(v.entryConfidence, 0.65); v.reasons = ["Gerçek ölçüm kesildi; önceki oda tahmini korunuyor"]; }
        else if (r && v.crossingAt && v.lastRawDataTimestamp - v.crossingAt <= this.gap(v, r) && v.history.some(e => e.room === r.id && e.weight >= 0.5 && e.at >= v.crossingAt)) {
          v.activeRegionId = r.id; v.lastKnown = r.id; v.state = "INFERRED_IN_REGION";
          v.reasons = ["Yönlü kapı geçişi ve iç ölçüm sonrası kesinti; tahmini oda"];
        } else { if (!v.candidateRegionId) v.state = "LOCATION_LOST"; v.reasons = ["Kesinti giriş kanıtı değildir; güncel konum belirsiz"]; }
      } else continue;
      this.send(v, true);
    }
  }
  private send(v: State, synthetic = false): ProcessedPosition {
    const r = this.region(v.activeRegionId), raw = v.lastRawPosition;
    const kind = v.state === "IN_REGION" || v.state === "TRACKING_OUTSIDE" ? "measured" : v.state === "INFERRED_IN_REGION" || v.state === "EXIT_CANDIDATE" ? "estimated" : "uncertain";
    const position: ProcessedPosition = { ...raw, x: r?.roomCenter.x ?? raw.x, y: r?.roomCenter.y ?? raw.y,
      decisionId: createHash("sha256").update(JSON.stringify([v.vehicleId,raw.timestamp,this.now(),v.state,v.activeRegionId,v.candidateRegionId,this.config?.version])).digest("hex"),
      timestamp: raw.timestamp, publishedAt: new Date(this.now()).toISOString(), synthetic,
      engineVersion: ROOM_ENGINE_VERSION, configVersion: this.config?.version ?? "unversioned",
      positionSource: r ? "REGION_CENTER" : "RAW", rawPosition: raw, lastRawDataTimestamp: raw.timestamp,
      regionInference: { enabled: true, state: v.state, regionId: v.state === "LOCATION_LOST" ? null : v.activeRegionId,
        regionName: v.state === "LOCATION_LOST" ? null : r?.name ?? null, candidateRegionId: v.candidateRegionId, lastKnownRegionId: v.lastKnown,
        confidence: v.entryConfidence, reasons: v.reasons, measurementKind: kind,
        uncertainAfter: new Date(v.lastRawDataTimestamp + this.lostAfter(v, r)).toISOString(),
        validUntil: new Date(v.lastRawDataTimestamp + this.staleAfter(v, r)).toISOString() } };
    v.resolvedPosition = position; v.lastPublishedTimestamp = this.now(); this.publish(position); return position;
  }
}
