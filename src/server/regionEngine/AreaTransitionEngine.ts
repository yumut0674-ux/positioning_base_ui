import { createHash } from "node:crypto";
import type { TrackingPosition } from "../trackingBuffer";
import type { CompiledLargeArea, CompiledRegionsConfig } from "./types";

export type AreaEventType = "AREA_ENTERED" | "AREA_EXITED_OBSERVED" | "AREA_EXITED_ESTIMATED" | "AREA_EXITED_FLOOR_INFERRED";
export interface AreaTransitionEvent {
  readonly id: string; readonly tagCode: string; readonly mapId: string; readonly areaId: string; readonly areaName: string;
  readonly gateId: string | null; readonly type: AreaEventType; readonly observed: boolean;
  readonly lastMeasuredAt: string; readonly decidedAt: string; readonly reason: string; readonly configVersion: string;
  readonly transitionId: string | null;
}
export interface AreaMembershipState {
  readonly tagCode: string; readonly mapId: string; readonly areaId: string; inside: boolean;
  revision?: number;
  lastAt: number; lastX: number; lastY: number; lastGateId: string | null;
  pendingGateId: string | null; pendingSince: number | null;
  entryGateId: string | null; entryCandidateAt: number | null;
  candidateSide: "inside" | "outside" | null; candidateAt: number | null; candidateCount: number;
}
type ConfigByMap = ReadonlyMap<string, CompiledRegionsConfig>;
const contains = (polygon: readonly { readonly x: number; readonly y: number }[], x: number, y: number) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
const key = (tag: string, map: string, area: string) => `${tag}\u0000${map}\u0000${area}`;
const newState = (tagCode: string, mapId: string, areaId: string): AreaMembershipState => ({
  tagCode, mapId, areaId, inside: false, revision: 0, lastAt: 0, lastX: 0, lastY: 0, lastGateId: null,
  pendingGateId: null, pendingSince: null, entryGateId: null, entryCandidateAt: null,
  candidateSide: null, candidateAt: null, candidateCount: 0,
});
export type AreaSourceHealth = "healthy" | "outage" | "unknown";
export interface PendingAreaExitDiagnostic {
  readonly tagCode: string; readonly mapId: string; readonly areaId: string; readonly gateId: string;
  readonly lastMeasuredAt: string; readonly dueAt: string; readonly sourceHealth: AreaSourceHealth; readonly reason: string;
}
const HEALTH_TTL_MS = 15_000;

/** Raw, quality checked area membership. Room centre positions never enter this engine. */
export class AreaTransitionEngine {
  private states = new Map<string, AreaMembershipState>();
  private latestByTag = new Map<string, number>();
  private sourceHealth = new Map<string, { healthy: boolean; at: number }>();
  private ingestReservationTaken = false;
  public constructor(private readonly configs: ConfigByMap, private readonly emit: (event: AreaTransitionEvent, state: AreaMembershipState) => void,
    private readonly changed: (state: AreaMembershipState) => void = () => undefined,
    private readonly reserveEvents: (count: number) => void = () => undefined) {}

  public restore(states: readonly AreaMembershipState[]): void {
    for (const state of states) {
      if (!this.configs.get(state.mapId)?.largeAreas.some(area => area.id === state.areaId)) continue;
      this.states.set(key(state.tagCode, state.mapId, state.areaId), { ...state });
      this.latestByTag.set(state.tagCode, Math.max(this.latestByTag.get(state.tagCode) ?? 0, state.lastAt));
    }
  }
  public snapshot(): readonly AreaMembershipState[] { return [...this.states.values()].map(state => ({ ...state })); }
  public noteSourceHealth(mapId: string, healthy: boolean, at: number): void {
    if (!this.configs.has(mapId) || !Number.isFinite(at) || at < (this.sourceHealth.get(mapId)?.at ?? 0)) return;
    this.sourceHealth.set(mapId, { healthy, at });
  }
  public health(mapId: string, now: number): AreaSourceHealth {
    const source = this.sourceHealth.get(mapId);
    return !source || now - source.at > HEALTH_TTL_MS || source.at > now + 2000 ? "unknown" : source.healthy ? "healthy" : "outage";
  }
  public diagnostics(now: number): { sourceHealth: Record<string, AreaSourceHealth>; pendingExits: PendingAreaExitDiagnostic[] } {
    const sourceHealth = Object.fromEntries([...this.configs.keys()].map(mapId => [mapId, this.health(mapId, now)])) as Record<string, AreaSourceHealth>;
    const pendingExits = [...this.states.values()].flatMap(state => {
      if (!state.inside || !state.pendingGateId || state.pendingSince === null) return [];
      const gate = this.configs.get(state.mapId)?.largeAreas.find(area => area.id === state.areaId)?.gates.find(item => item.id === state.pendingGateId);
      if (!gate) return [];
      const health = sourceHealth[state.mapId];
      return [{ tagCode: state.tagCode, mapId: state.mapId, areaId: state.areaId, gateId: gate.id,
        lastMeasuredAt: new Date(state.lastAt).toISOString(), dueAt: new Date(state.pendingSince + gate.waitMs).toISOString(),
        sourceHealth: health, reason: health === "healthy" ? "Bekleme süresi veya sonraki ölçüm bekleniyor."
          : health === "outage" ? "Genel kaynak kesintisi bildirildi; tahmini çıkış durduruldu."
            : "Kaynak sağlığı bilinmiyor veya heartbeat süresi doldu; tahmini çıkış durduruldu." }];
    });
    return { sourceHealth, pendingExits };
  }

  public ingest(position: TrackingPosition, now = Date.now()): void {
    const mapId = position.mapId, config = mapId ? this.configs.get(mapId) : undefined;
    if (!config) return;
    const at = Date.parse(position.timestamp);
    if (!Number.isFinite(at) || !Number.isFinite(position.x) || !Number.isFinite(position.y) || at > now + 2000 || now - at > config.areaTracking.confirmationWindowMs) return;
    if (position.quality !== undefined && (!Number.isFinite(position.quality) || position.quality < config.areaTracking.minimumQuality)) return;
    if (at <= (this.latestByTag.get(position.tagCode) ?? 0)) return;
    const previous = [...this.states.values()].find(state => state.tagCode === position.tagCode && state.lastAt === (this.latestByTag.get(position.tagCode) ?? 0));
    if (previous && previous.mapId === mapId && at > previous.lastAt) {
      const speed = Math.hypot(position.x - previous.lastX, position.y - previous.lastY) / ((at - previous.lastAt) / 1000);
      if (speed > config.areaTracking.maximumSpeedMetersPerSecond) return;
    }
    const priorAt = this.latestByTag.get(position.tagCode);
    const priorStates = [...this.states.entries()].filter(([, state]) => state.tagCode === position.tagCode).map(([id, state]) => [id, { ...state }] as const);
    this.latestByTag.set(position.tagCode, at);
    try { for (const area of config.largeAreas) this.advance(position, at, now, area, config); }
    catch (error) {
      for (const [id, state] of this.states) if (state.tagCode === position.tagCode) this.states.delete(id);
      for (const [id, state] of priorStates) this.states.set(id, state);
      if (priorAt === undefined) this.latestByTag.delete(position.tagCode); else this.latestByTag.set(position.tagCode, priorAt);
      throw error;
    } finally { this.ingestReservationTaken = false; }
  }

  private reserveForMeasurement(tagCode: string, mapId: string, config: CompiledRegionsConfig): void {
    if (this.ingestReservationTaken) return;
    const oldInside = [...this.states.values()].filter(state => state.tagCode === tagCode && state.mapId !== mapId && state.inside).length;
    this.reserveEvents(config.largeAreas.length + oldInside);
    this.ingestReservationTaken = true;
  }

  private advance(position: TrackingPosition, at: number, now: number, area: CompiledLargeArea, config: CompiledRegionsConfig): void {
    const mapId = position.mapId!; const stateKey = key(position.tagCode, mapId, area.id);
    const state = this.states.get(stateKey) ?? newState(position.tagCode, mapId, area.id);
    this.states.set(stateKey, state);
    state.revision = (state.revision ?? 0) + 1;
    const gate = area.gates.find(item => contains(item.polygon, position.x, position.y));
    const within = contains(area.polygon, position.x, position.y);
    const priorGate = state.lastGateId;
    state.lastAt = at; state.lastX = position.x; state.lastY = position.y; state.lastGateId = gate?.id ?? null;
    if (state.inside) {
      if (gate && gate.role !== "entry") { state.pendingGateId = gate.id; state.pendingSince = at; }
      else if (gate || within) { state.pendingGateId = null; state.pendingSince = null; }
      if (!gate && !within && state.pendingGateId) {
        this.count(state, "outside", at, config.areaTracking.confirmationWindowMs);
        if (state.candidateCount >= config.areaTracking.confirmationCount) {
          this.reserveForMeasurement(state.tagCode, mapId, config);
          const exitGate = state.pendingGateId; const lastAt = at;
          const timely = state.pendingSince !== null && at - state.pendingSince <= config.areaTracking.confirmationWindowMs;
          state.inside = false; state.pendingGateId = null; state.pendingSince = null; state.entryGateId = null;
          this.event(state, area, config, exitGate, timely ? "AREA_EXITED_OBSERVED" : "AREA_EXITED_ESTIMATED", lastAt, now,
            timely ? "Çıkış geçiş bölgesinden dışarı güvenilir ölçümlerle geçildi."
              : "Dışarıda güvenilir ölçümler var, ancak çıkış kapısı kanıtı zaman aşımına uğradı; geçiş anı bilinmiyor.", null);
        }
      } else this.clearCandidate(state);
    } else {
      if (gate?.role === "entry" || gate?.role === "bidirectional") { state.entryGateId = gate.id; state.entryCandidateAt = at; this.clearCandidate(state); }
      else if (within && ((state.entryGateId && state.entryCandidateAt !== null && at - state.entryCandidateAt <= config.areaTracking.confirmationWindowMs)
        || [...this.states.values()].some(other => other.tagCode === state.tagCode && other.mapId !== mapId && other.inside))) {
        this.count(state, "inside", at, config.areaTracking.confirmationWindowMs);
        if (state.candidateCount >= config.areaTracking.confirmationCount) {
          this.reserveForMeasurement(state.tagCode, mapId, config);
          const entryGate = state.entryGateId; state.inside = true; this.clearCandidate(state);
          const transitionId = [...this.states.values()].some(other => other.tagCode === state.tagCode && other.mapId !== mapId && other.inside)
            ? createHash("sha256").update(`${state.tagCode}:${state.mapId}:${state.areaId}:${state.lastAt}`).digest("hex").slice(0, 24) : null;
          this.event(state, area, config, entryGate, "AREA_ENTERED", at, now,
            entryGate ? "Giriş geçiş bölgesi ardından alan içinde güvenilir ölçümler doğrulandı." : "Başka haritadaki alandan sonra bu alanda güvenilir ölçümler doğrulandı.", transitionId);
          if (transitionId) this.crossFloor(state, now, transitionId);
        }
      } else if (!gate || (gate.id !== priorGate && gate.role === "exit")) { state.entryGateId = null; state.entryCandidateAt = null; this.clearCandidate(state); }
    }
    this.changed({ ...state });
  }
  private crossFloor(entered: AreaMembershipState, now: number, transitionId: string): void {
    for (const other of this.states.values()) {
      if (other.tagCode !== entered.tagCode || other.mapId === entered.mapId || !other.inside) continue;
      const config = this.configs.get(other.mapId), area = config?.largeAreas.find(item => item.id === other.areaId);
      if (!config || !area) continue;
      other.inside = false; other.pendingGateId = null; other.pendingSince = null; other.revision = (other.revision ?? 0) + 1;
      this.event(other, area, config, other.lastGateId, "AREA_EXITED_FLOOR_INFERRED", other.lastAt, now,
        `Başka haritada güvenilir alan girişi doğrulandı: ${entered.mapId}/${entered.areaId}. Eski katın çıkış kapısı geçişi gözlemlenmedi.`, transitionId);
      this.changed({ ...other });
    }
  }
  public tick(now: number): void {
    for (const state of this.states.values()) {
      if (this.health(state.mapId, now) !== "healthy") continue;
      if (!state.inside || !state.pendingGateId || state.pendingSince === null) continue;
      const config = this.configs.get(state.mapId), area = config?.largeAreas.find(item => item.id === state.areaId);
      const gate = area?.gates.find(item => item.id === state.pendingGateId);
      if (!config || !area || !gate || state.lastGateId !== gate.id || now - state.pendingSince < gate.waitMs) continue;
      this.reserveEvents(1);
      const before = { ...state };
      state.inside = false; state.pendingGateId = null; state.pendingSince = null; state.entryGateId = null; state.revision = (state.revision ?? 0) + 1;
      try {
        this.event(state, area, config, gate.id, "AREA_EXITED_ESTIMATED", state.lastAt, now,
          `Son güvenilir ölçüm çıkış bölgesindeydi; ${gate.waitMs / 1000} saniye boyunca içeriden veya başka geçiş bölgesinden veri gelmedi. Fiziksel çıkış anı bilinmiyor.`, null);
        this.changed({ ...state });
      } catch (error) { Object.assign(state, before); throw error; }
    }
  }
  private count(state: AreaMembershipState, side: "inside" | "outside", at: number, windowMs: number): void {
    if (state.candidateSide !== side || state.candidateAt === null || at - state.candidateAt > windowMs) {
      state.candidateSide = side; state.candidateAt = at; state.candidateCount = 1;
    } else state.candidateCount++;
  }
  private clearCandidate(state: AreaMembershipState): void { state.candidateSide = null; state.candidateAt = null; state.candidateCount = 0; }
  private event(state: AreaMembershipState, area: CompiledLargeArea, config: CompiledRegionsConfig, gateId: string | null,
    type: AreaEventType, lastAt: number, now: number, reason: string, transitionId: string | null): void {
    const id = createHash("sha256").update([state.tagCode, state.mapId, area.id, gateId, type, lastAt].join("|")).digest("hex");
    this.emit({ id, tagCode: state.tagCode, mapId: state.mapId, areaId: area.id, areaName: area.name, gateId,
      type, observed: type === "AREA_ENTERED" || type === "AREA_EXITED_OBSERVED", lastMeasuredAt: new Date(lastAt).toISOString(),
      decidedAt: new Date(now).toISOString(), reason, configVersion: config.version ?? "unknown", transitionId }, { ...state });
  }
}
