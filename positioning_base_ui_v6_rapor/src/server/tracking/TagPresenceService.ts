import { randomUUID } from "node:crypto";
import type { PositionMessage } from "../../features/tracking/types/tracking.types";
import type { LastObservedLocation, PersistedTagObservation, TagPresenceSnapshot, TagPresenceState, TagPresenceUpdate } from "../../features/tracking/types/tagPresence.types";
import { DEFAULT_SYSTEM_SETTINGS, type SystemSettings } from "../../features/settings/types/settings.types";

const ROOM_STATES = new Set(["IN_REGION", "INFERRED_IN_REGION", "EXIT_CANDIDATE", "ROOM_TRANSITIONED"]);
const MAX_TAGS = 5_000;

/** Independent of room inference: engine timer publications are never raw observations. */
export class TagPresenceService {
  public readonly epoch = randomUUID();
  private readonly states = new Map<string, TagPresenceState>();
  private readonly roomIds = new Map<string, ReadonlySet<string>>();
  private readonly listeners = new Set<(event: TagPresenceUpdate) => void>();
  private settings: SystemSettings = structuredClone(DEFAULT_SYSTEM_SETTINGS);
  private enabled = false;
  private sequence = 0;

  public constructor(private readonly now = Date.now) {}

  public configureMap(mapId: string, ids: ReadonlySet<string>): void { this.roomIds.set(mapId, ids); }
  public get(tagCode: string): TagPresenceState | undefined { return this.states.get(tagCode); }
  public getSettings(): SystemSettings { return this.settings; }
  public subscribe(listener: (event: TagPresenceUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  public snapshot(warning: string | null = null): TagPresenceSnapshot {
    return { epoch: this.epoch, serverNow: this.now(), settings: this.settings, states: [...this.states.values()], warning };
  }

  public observeRaw(raw: PositionMessage, location: LastObservedLocation): boolean {
    if (raw.synthetic || !Number.isFinite(raw.timestamp) || raw.timestamp > this.now() + 5_000) return false;
    const tagCode = raw.id.toUpperCase(), current = this.states.get(tagCode);
    if (current && raw.timestamp <= current.lastRawMeasuredAt) return false;
    const received = raw.receivedAt ? Date.parse(raw.receivedAt) : this.now();
    const lastRawReceivedAt = Number.isFinite(received) ? Math.min(received, this.now()) : this.now();
    const processed = current?.raw.mapId === raw.mapId ? current?.processed : undefined;
    this.commit({ tagCode, raw: { ...raw, id: tagCode }, processed, lastObservedLocation: location,
      lastRawMeasuredAt: raw.timestamp, lastRawReceivedAt, revision: 0,
      hasCurrentRoomAssignment: false, hiddenForNoData: false, hiddenSince: current?.hiddenSince ?? null });
    return true;
  }

  public observeDecision(processed: PositionMessage): void {
    const current = this.states.get(processed.id.toUpperCase());
    if (!current || current.raw.mapId !== processed.mapId) return;
    const incomingAt = Date.parse(processed.publishedAt ?? "");
    const previousAt = Date.parse(current.processed?.publishedAt ?? "");
    if (!Number.isFinite(incomingAt) || (Number.isFinite(previousAt) && incomingAt <= previousAt)) return;
    // No payload changes are needed for repeated centre heartbeats.
    const comparable = (p: PositionMessage | undefined) => JSON.stringify(p && {
      timestamp: p.timestamp, x: p.x, y: p.y, regionInference: p.regionInference,
    });
    if (comparable(current.processed) === comparable(processed)) return;
    this.commit({ ...current, processed });
  }

  public setEngineEnabled(enabled: boolean): void {
    this.enabled = enabled;
    for (const state of this.states.values()) this.commit({ ...state, processed: undefined });
  }

  public invalidateMap(mapId: string): void {
    for (const state of this.states.values()) if (state.raw.mapId === mapId) this.commit({ ...state, processed: undefined });
  }

  public setSettings(settings: SystemSettings): void {
    this.settings = settings;
    this.tick();
  }

  public restore(observations: readonly PersistedTagObservation[]): void {
    for (const observation of observations) {
      if (this.states.has(observation.tagCode)) continue;
      this.commit({ ...observation, processed: undefined, revision: 0,
        hasCurrentRoomAssignment: false, hiddenForNoData: false, hiddenSince: null });
    }
  }

  public tick(): void {
    for (const current of this.states.values()) {
      const derived = this.evaluate(current);
      if (derived.hiddenForNoData !== current.hiddenForNoData || derived.hasCurrentRoomAssignment !== current.hasCurrentRoomAssignment) this.commit(derived);
    }
  }

  private evaluate(state: TagPresenceState): TagPresenceState {
    const d = state.processed?.regionInference;
    const uncertainAt = Date.parse(d?.uncertainAfter ?? "");
    const hasCurrentRoomAssignment = Boolean(this.enabled && state.raw.mapId && d?.enabled && d.regionId
      && this.roomIds.get(state.raw.mapId)?.has(d.regionId) && ROOM_STATES.has(d.state)
      && Number.isFinite(uncertainAt) && this.now() < uncertainAt);
    // A delayed backlog cannot turn an old observation into a live position.
    const age = Math.max(this.now() - state.lastRawReceivedAt, this.now() - state.lastRawMeasuredAt);
    const hiddenForNoData = age > this.settings.tracking.noDataHideAfterMs && !hasCurrentRoomAssignment;
    return { ...state, hasCurrentRoomAssignment, hiddenForNoData,
      hiddenSince: hiddenForNoData ? state.hiddenSince ?? this.now() : null };
  }

  private commit(input: TagPresenceState): void {
    const state = { ...this.evaluate(input), revision: ++this.sequence };
    if (!this.states.has(state.tagCode) && this.states.size >= MAX_TAGS) {
      // Reconnect snapshots replace the client set, including evicted unknown publishers.
      this.states.delete(this.states.keys().next().value!);
    }
    this.states.set(state.tagCode, state);
    const event = { epoch: this.epoch, serverNow: this.now(), state };
    for (const listener of this.listeners) listener(event);
  }
}
