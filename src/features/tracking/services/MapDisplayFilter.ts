import type { Point2D } from "@/src/shared/types/geometry";
import type { RegionDefinition } from "@/src/features/regions/types/region.types";
import type { TrackedTag } from "../types/tracking.types";
import { PositionAnimationController } from "./PositionAnimationController";
import { inDisplayArea, projectIntoDisplayArea, segmentInDisplayArea, type DisplayPolygon } from "./displayArea";
import { AdaptivePositionFilter } from "./positionFilters";
import { shouldAcceptTagUpdate } from "./tagUpdateOrdering";
import { assignedDisplayRoomId, isCorridorRegion } from "./roomDisplayPolicy";

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
  private corridors: readonly DisplayPolygon[] = [];
  private rooms: ReadonlyMap<string, DisplayPolygon> | undefined;
  private readonly roomAreas = new Map<string, readonly DisplayPolygon[]>();
  private holdMs = 2_000;
  private mapId: string | null = null;
  private timer?: ReturnType<typeof setTimeout>;

  public constructor(
    private readonly animation: PositionAnimationController,
    private readonly changed: (displays: Record<string, MapTagDisplay>) => void,
    private readonly clock: Clock = { now: Date.now, setTimeout, clearTimeout },
  ) {}

  public configure(polygons: readonly DisplayPolygon[], holdMs: number, mapId: string | null = null,
    regions?: readonly RegionDefinition[]): void {
    if (this.mapId !== mapId) {
      for (const id of this.states.keys()) this.animation.remove(id);
      this.states.clear();
      this.mapId = mapId;
    }
    this.polygons = polygons;
    this.corridors = [];
    this.rooms = regions ? new Map(regions.filter(region => !isCorridorRegion(region))
      .map(region => [region.id, region.polygon.map(pair => pair.world)])) : undefined;
    if (regions) this.corridors = regions.filter(isCorridorRegion).map(region => region.polygon.map(pair => pair.world));
    this.roomAreas.clear();
    for (const [id, room] of this.rooms ?? []) this.roomAreas.set(id, [...this.corridors, room]);
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
    if (state && !force && !shouldAcceptTagUpdate(state.candidate, candidate)) return;
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
    const decision = tag.regionInference;
    const assignedRoomId = assignedDisplayRoomId(tag);
    const assignedRoom = assignedRoomId ? this.rooms?.get(assignedRoomId) : undefined;
    const allowedArea = this.rooms ? (assignedRoom ? this.roomAreas.get(assignedRoomId!)! : this.corridors) : this.polygons;
    // A lost location may still carry the last known centre in x/y. Only a
    // current engine assignment permits that room; candidates never do.
    const incoming = this.rooms && !assignedRoom ? (tag.rawPosition ?? tag) : tag;
    let target: Point2D | undefined = inDisplayArea(incoming, allowedArea) ? { x: incoming.x, y: incoming.y } : undefined;
    if (!target && this.rooms && !assignedRoom && inDisplayArea(incoming, this.polygons)) {
      target = projectIntoDisplayArea(incoming, this.corridors);
    }
    if (state.lastValid && !inDisplayArea(state.lastValid, allowedArea)) {
      state.lastValid = projectIntoDisplayArea(state.lastValid, this.corridors);
      state.stabilizer.reset(state.lastValid, tag.timestamp);
    }
    this.animation.setTagDisplayArea(tag.id, allowedArea, target ?? state.lastValid, now);
    if (target) {
      const resume = !state.display.visible || state.outsideSince !== undefined;
      let point: Point2D = target;
      // Smooth only presentation coordinates and only along a valid interior
      // path. Room centres and re-entry points must remain exact.
      if (state.smooth && state.lastValid && !resume && !snap
        && segmentInDisplayArea(state.lastValid, point, allowedArea)) {
        const averaged = state.stabilizer.next(state.lastValid, point, tag.timestamp);
        // The mean of valid points can lie outside a concave corridor. Never
        // queue that mean or draw a shortcut through an unassigned room.
        if (segmentInDisplayArea(state.lastValid, averaged, allowedArea)) point = averaged;
        else state.stabilizer.reset(point, tag.timestamp);
      } else state.stabilizer.reset(point, tag.timestamp);
      this.animation.ingest(tag.id, { ...point, timestamp: tag.timestamp, receivedAt: now,
        measurementTimestamp: tag.timestamp, positionSource: this.rooms && !assignedRoom ? "RAW" : tag.positionSource ?? "RAW",
        regionId: this.rooms && !assignedRoom ? null : decision?.regionId, displayArea: allowedArea });
      state.lastValid = point;
      state.outsideSince = undefined;
      state.display = { visible: true, position: point };
      return;
    }
    // Receipt time measures the continuous outside episode; duplicates, later
    // outside samples and synthetic engine publications never extend it.
    state.outsideSince ??= now;
    const visible = allowedArea.length > 0 && !!state.lastValid && now - state.outsideSince < this.holdMs;
    state.display = { visible, position: state.lastValid, reason: this.polygons.length ? "outside" : "no-regions" };
    if (visible) {
      // A configuration change emptied the queue: restore only the validated hold point.
      if (snap && state.lastValid) this.animation.ingest(tag.id, { ...state.lastValid,
        timestamp: tag.timestamp, measurementTimestamp: tag.timestamp, receivedAt: now, displayArea: allowedArea });
      this.animation.hold(tag.id, tag.timestamp, now);
    } else this.animation.hold(tag.id, tag.timestamp, now);
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
