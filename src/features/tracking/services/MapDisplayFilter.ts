import type { Point2D } from "@/src/shared/types/geometry";
import type { TrackedTag } from "../types/tracking.types";
import { PositionAnimationController } from "./PositionAnimationController";
import { inDisplayArea, segmentInDisplayArea, type DisplayPolygon } from "./displayArea";
import { AdaptivePositionFilter } from "./positionFilters";

export interface MapTagDisplay {
  readonly visible: boolean;
  readonly position?: Point2D;
  readonly reason?: "outside" | "no-regions";
}
interface State {
  candidate: TrackedTag;
  lastValid?: Point2D;
  outsideSince?: number;
  display: MapTagDisplay;
  smooth: boolean;
  stabilizer: AdaptivePositionFilter;
}
interface Clock {
  now(): number;
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

/** Presentation only: never publishes a measurement or writes a room/history record. */
export class MapDisplayFilter {
  private readonly states = new Map<string, State>();
  private polygons: readonly DisplayPolygon[] = [];
  private holdMs = 2_000;
  private mapId: string | null = null;
  private timer?: ReturnType<typeof setTimeout>;

  public constructor(
    private readonly animation: PositionAnimationController,
    private readonly changed: (displays: Record<string, MapTagDisplay>) => void,
    private readonly clock: Clock = { now: Date.now, setTimeout, clearTimeout },
  ) {}

  public configure(polygons: readonly DisplayPolygon[], holdMs: number, mapId: string | null = null): void {
    if (this.mapId !== mapId) {
      for (const id of this.states.keys()) this.animation.remove(id);
      this.states.clear();
      this.mapId = mapId;
    }
    this.polygons = polygons;
    this.holdMs = holdMs;
    this.animation.setDisplayArea(polygons);
    for (const state of this.states.values()) {
      if (state.lastValid && !inDisplayArea(state.lastValid, polygons)) state.lastValid = undefined;
      this.evaluate(state, true);
    }
    this.publish();
  }

  public ingest(candidate: TrackedTag, smooth = false, force = false): void {
    if (this.mapId && candidate.mapId !== this.mapId) return;
    let state = this.states.get(candidate.id);
    if (state && !force) {
      if (candidate.timestamp < state.candidate.timestamp) return;
      if (candidate.timestamp === state.candidate.timestamp
        && (!candidate.publishedAt || (state.candidate.publishedAt && candidate.publishedAt <= state.candidate.publishedAt))) return;
    }
    if (!state) {
      state = { candidate, smooth, stabilizer: new AdaptivePositionFilter(), display: { visible: false, reason: "outside" } };
      this.states.set(candidate.id, state);
    } else { state.candidate = candidate; state.smooth = smooth; }
    this.evaluate(state, force);
    this.publish();
  }

  public retain(ids: ReadonlySet<string>): void {
    let changed = false;
    for (const id of this.states.keys()) if (!ids.has(id)) {
      this.states.delete(id);
      this.animation.remove(id);
      changed = true;
    }
    if (changed) this.publish();
  }

  public dispose(): void {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    this.states.clear();
    this.animation.clear();
  }

  private evaluate(state: State, snap = false): void {
    const tag = state.candidate, now = this.clock.now();
    if (inDisplayArea(tag, this.polygons)) {
      const resume = !state.display.visible || state.outsideSince !== undefined;
      let point: Point2D = { x: tag.x, y: tag.y };
      // Smooth only presentation coordinates and only along a valid interior
      // path. Room centres and re-entry points must remain exact.
      if (state.smooth && state.lastValid && !resume && !snap
        && segmentInDisplayArea(state.lastValid, point, this.polygons)) {
        point = state.stabilizer.next(state.lastValid, point, tag.timestamp);
      } else state.stabilizer.reset(point, tag.timestamp);
      if (resume || snap) this.animation.remove(tag.id);
      this.animation.ingest(tag.id, { ...point, timestamp: tag.timestamp, receivedAt: now,
        measurementTimestamp: tag.timestamp, positionSource: tag.positionSource ?? "RAW",
        regionId: tag.regionInference?.regionId });
      state.lastValid = point;
      state.outsideSince = undefined;
      state.display = { visible: true, position: point };
      return;
    }
    // Receipt time measures the continuous outside episode; duplicates, later
    // outside samples and synthetic engine publications never extend it.
    state.outsideSince ??= now;
    const visible = this.polygons.length > 0 && !!state.lastValid && now - state.outsideSince < this.holdMs;
    state.display = { visible, position: state.lastValid, reason: this.polygons.length ? "outside" : "no-regions" };
    if (visible) {
      // A configuration change emptied the queue: restore only the validated hold point.
      if (snap && state.lastValid) this.animation.ingest(tag.id, { ...state.lastValid,
        timestamp: tag.timestamp, measurementTimestamp: tag.timestamp, receivedAt: now });
      this.animation.hold(tag.id, tag.timestamp, now);
    } else this.animation.remove(tag.id);
  }

  private publish(): void {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    let deadline = Infinity;
    for (const state of this.states.values()) if (state.display.visible && state.outsideSince !== undefined) {
      deadline = Math.min(deadline, state.outsideSince + this.holdMs);
    }
    if (Number.isFinite(deadline)) this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      for (const state of this.states.values()) if (state.outsideSince !== undefined) this.evaluate(state);
      this.publish();
    }, Math.max(0, deadline - this.clock.now()));
    this.changed(Object.fromEntries([...this.states].map(([id, state]) => [id, state.display])));
  }
}
