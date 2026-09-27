import type {
  PositionAnimationConfig,
  PositionSample,
  TagAnimationState,
} from "../types/tracking.types";
import { inDisplayArea, segmentInDisplayArea, type DisplayPolygon } from "./displayArea";

export interface PositionRenderer {
  render(x: number, y: number, stale: boolean, opacity: number): void;
}

interface Transition {
  readonly kind: "normal-route" | "region-center-route";
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly startedAt: number;
  readonly durationMs: number;
}

interface NonRoutableRegionRelocation {
  readonly kind: "non-routable-region-relocation";
  readonly destination: PositionSample;
  readonly startedAt: number;
  readonly durationMs: number;
  snapped: boolean;
}

interface InternalTagAnimationState extends Omit<TagAnimationState, "transitionKind"> {
  lastReceivedAt: number;
  lastRenderTime: number;
  renderer?: PositionRenderer;
  transition?: Transition;
  relocation?: NonRoutableRegionRelocation;
}

export interface IncomingAnimationPosition {
  readonly measurementTimestamp?: number;
  readonly x: number;
  readonly y: number;
  readonly timestamp?: number;
  readonly receivedAt?: number;
  readonly positionSource?: "RAW" | "REGION_CENTER";
  readonly regionId?: string | null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function distance(a: { readonly x: number; readonly y: number }, b: { readonly x: number; readonly y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function samePosition(a: PositionSample, b: PositionSample): boolean {
  return a.x === b.x && a.y === b.y;
}

function easedProgress(progress: number, easing: PositionAnimationConfig["easing"]): number {
  if (easing === "linear") return progress;
  return progress * progress * (3 - 2 * progress);
}

export class PositionAnimationController {
  private displayArea: readonly DisplayPolygon[] | undefined;
  private readonly states = new Map<string, InternalTagAnimationState>();
  private readonly renderers = new Map<string, PositionRenderer>();

  public constructor(private config: PositionAnimationConfig) {}

  public setDisplayArea(polygons: readonly DisplayPolygon[]): void {
    this.displayArea = polygons;
    this.states.clear(); // Geometry changes invalidate all queued paths.
  }

  public remove(tagId: string): void { this.states.delete(tagId); }

  public clear(): void { this.states.clear(); }

  public hold(tagId: string, measurementTimestamp: number, now = Date.now()): void {
    const state = this.states.get(tagId);
    const latest = state?.samples.at(-1);
    if (!state || !latest) return;
    state.samples = [latest];
    state.transition = undefined;
    state.relocation = undefined;
    state.lastReceivedAt = measurementTimestamp;
    const wasStale = state.stale;
    state.stale = now - state.lastReceivedAt > this.config.stalePositionTimeoutMs;
    this.apply(state, latest.x, latest.y, now, wasStale);
    this.applyOpacity(state, 1, now, state.stale);
  }

  public setConfig(config: PositionAnimationConfig, now = Date.now()): void {
    this.config = config;
    if (config.enabled) return;
    for (const state of this.states.values()) {
      const latest = state.samples.at(-1);
      state.transition = undefined;
      state.relocation = undefined;
      if (!latest) continue;
      state.samples = [latest];
      this.apply(state, latest.x, latest.y, now);
      this.applyOpacity(state, 1, now, state.stale);
    }
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public attach(tagId: string, renderer: PositionRenderer): () => void {
    this.renderers.set(tagId, renderer);
    const state = this.states.get(tagId);
    if (state) {
      state.renderer = renderer;
      renderer.render(state.renderedX, state.renderedY, state.stale, state.visualOpacity);
    }
    return () => {
      if (this.renderers.get(tagId) === renderer) this.renderers.delete(tagId);
      const current = this.states.get(tagId);
      if (current?.renderer === renderer) current.renderer = undefined;
    };
  }

  public ingest(tagId: string, incoming: IncomingAnimationPosition): void {
    if (!Number.isFinite(incoming.x) || !Number.isFinite(incoming.y)) return;
    if (this.displayArea && !inDisplayArea(incoming, this.displayArea)) return;
    const receivedAt = Number.isFinite(incoming.receivedAt) ? incoming.receivedAt! : Date.now();
    const timestamp = Number.isFinite(incoming.timestamp) && incoming.timestamp! > 0
      ? incoming.timestamp!
      : receivedAt;
    const sample: PositionSample = {
      x: incoming.x,
      y: incoming.y,
      timestamp,
      receivedAt,
      positionSource: incoming.positionSource ?? "RAW",
      regionId: incoming.regionId ?? null,
    };
    let state = this.states.get(tagId);
    if (!state) {
      state = {
        samples: [sample],
        renderedX: sample.x,
        renderedY: sample.y,
        lastRenderedAt: receivedAt,
        stale: receivedAt - (incoming.measurementTimestamp ?? receivedAt) > this.config.stalePositionTimeoutMs,
        visualOpacity: 1,
        relocationSequence: 0,
        lastReceivedAt: incoming.measurementTimestamp ?? receivedAt,
        lastRenderTime: Number.NEGATIVE_INFINITY,
        renderer: this.renderers.get(tagId),
      };
      this.states.set(tagId, state);
      state.renderer?.render(sample.x, sample.y, state.stale, state.visualOpacity);
      return;
    }

    const latest = state.samples.at(-1);
    if (latest && sample.timestamp < latest.timestamp && (sample.positionSource === "REGION_CENTER" || latest.positionSource === "REGION_CENTER")) return;
    if (latest && sample.positionSource === "REGION_CENTER" && latest.positionSource === "REGION_CENTER"
      && latest.regionId === sample.regionId && samePosition(latest, sample)) {
      state.lastReceivedAt = incoming.measurementTimestamp ?? receivedAt;
      state.stale = receivedAt - state.lastReceivedAt > this.config.stalePositionTimeoutMs;
      state.samples = [sample];
      return;
    }
    const renderedSegmentIsValid = !this.displayArea
      || segmentInDisplayArea({ x: state.renderedX, y: state.renderedY }, sample, this.displayArea);
    const queuedSegmentIsValid = !this.displayArea || !latest || segmentInDisplayArea(latest, sample, this.displayArea);
    if (this.displayArea && (!renderedSegmentIsValid || !queuedSegmentIsValid)) {
      state.samples = [sample];
      state.lastReceivedAt = incoming.measurementTimestamp ?? receivedAt;
      state.stale = receivedAt - state.lastReceivedAt > this.config.stalePositionTimeoutMs;
      // A confirmed room centre can be separated from the last raw point by a
      // tiny map gap. Fade and relocate instead of leaving the marker at the door.
      if (this.config.enabled && sample.positionSource === "REGION_CENTER") {
        this.startNonRoutableRegionRelocation(state, sample, receivedAt);
      } else if (this.config.enabled) {
        this.startTransition(state, sample, receivedAt, this.transitionDuration(state, sample, this.config.teleportAnimationDurationMs), "normal-route");
      }
      else this.apply(state, sample.x, sample.y, receivedAt);
      return;
    }
    // Room coordinates are display anchors, but changing anchors must still be a
    // visible, bounded transition. Repeated heartbeats at the same centre do not
    // restart the transition.
    if (sample.positionSource === "REGION_CENTER" || latest?.positionSource === "REGION_CENTER") {
      state.lastReceivedAt = incoming.measurementTimestamp ?? receivedAt;
      state.stale = receivedAt - state.lastReceivedAt > this.config.stalePositionTimeoutMs;
      if (latest && samePosition(latest, sample)) {
        state.samples = [sample];
        return;
      }
      state.samples = [sample];
      state.relocation = undefined;
      if (this.config.enabled) this.startTransition(state, sample, receivedAt, this.transitionDuration(state, sample, this.config.regionTransitionDurationMs), "region-center-route");
      else this.apply(state, sample.x, sample.y, receivedAt);
      return;
    }
    if (state.samples.some((item) => item.timestamp === sample.timestamp && samePosition(item, sample))) {
      const wasStale = state.stale;
      state.stale = receivedAt - state.lastReceivedAt > this.config.stalePositionTimeoutMs;
      this.apply(state, state.renderedX, state.renderedY, receivedAt, wasStale);
      return;
    }
    if (sample.timestamp <= state.lastRenderTime) return;

    state.lastReceivedAt = incoming.measurementTimestamp ?? receivedAt;
    state.stale = receivedAt - state.lastReceivedAt > this.config.stalePositionTimeoutMs;

    if (!this.config.enabled) {
      state.samples = [sample];
      state.transition = undefined;
      state.relocation = undefined;
      this.apply(state, sample.x, sample.y, receivedAt);
      return;
    }

    const insertionIndex = state.samples.findIndex((item) => item.timestamp > sample.timestamp);
    if (insertionIndex === -1) state.samples.push(sample);
    else state.samples.splice(insertionIndex, 0, sample);

    const sampleIndex = state.samples.indexOf(sample);
    const previous = sampleIndex > 0 ? state.samples[sampleIndex - 1] : undefined;
    const isNewest = sampleIndex === state.samples.length - 1;
    if (isNewest && previous) {
      const duration = sample.timestamp - previous.timestamp;
      if (duration > this.config.maximumSegmentDurationMs || distance(previous, sample) > this.config.teleportDistanceMeters) {
        state.samples = [sample];
        this.startTransition(state, sample, receivedAt, this.transitionDuration(state, sample, this.config.teleportAnimationDurationMs), "normal-route");
        return;
      }
    }

    this.trimToMaximumSize(state);
  }

  public update(now = Date.now()): void {
    if (!this.config.enabled) return;
    const renderTime = now - this.config.interpolationDelayMs;
    for (const [tagId, state] of this.states) {
      const wasStale = state.stale;
      state.stale = now - state.lastReceivedAt > this.config.stalePositionTimeoutMs;

      // Guarded states are owned/pruned by MapDisplayFilter. Keep their validated
      // position while the layer is hidden so reattaching cannot render at (0, 0).
      if (!this.displayArea && !state.renderer && now - state.lastReceivedAt > this.config.stalePositionTimeoutMs * 2) {
        this.states.delete(tagId);
        continue;
      }

      if (state.transition) {
        const transition = state.transition;
        const linearProgress = transition.durationMs === 0
          ? 1
          : clamp((now - transition.startedAt) / transition.durationMs, 0, 1);
        const progress = easedProgress(linearProgress, this.config.easing);
        this.apply(
          state,
          transition.fromX + (transition.toX - transition.fromX) * progress,
          transition.fromY + (transition.toY - transition.fromY) * progress,
          now,
          wasStale,
        );
        if (linearProgress >= 1) state.transition = undefined;
        state.lastRenderTime = Math.max(state.lastRenderTime, renderTime);
        this.discardRenderedHistory(state, renderTime);
        continue;
      }

      if (state.relocation) {
        this.renderNonRoutableRegionRelocation(state, now, wasStale);
        state.lastRenderTime = Math.max(state.lastRenderTime, renderTime);
        continue;
      }

      this.renderTimeline(state, renderTime, now, wasStale);
      state.lastRenderTime = Math.max(state.lastRenderTime, renderTime);
      this.discardRenderedHistory(state, renderTime);
    }
  }

  public getState(tagId: string): Readonly<TagAnimationState> | undefined {
    const state = this.states.get(tagId);
    if (!state) return undefined;
    return {
      samples: state.samples,
      renderedX: state.renderedX,
      renderedY: state.renderedY,
      lastRenderedAt: state.lastRenderedAt,
      stale: state.stale,
      visualOpacity: state.visualOpacity,
      transitionKind: state.relocation?.kind ?? state.transition?.kind ?? null,
      relocationSequence: state.relocationSequence,
    };
  }

  private renderTimeline(state: InternalTagAnimationState, renderTime: number, now: number, wasStale: boolean): void {
    const samples = state.samples;
    if (samples.length === 0) return;
    if (samples.length === 1 || renderTime <= samples[0].timestamp) {
      this.apply(state, samples[0].x, samples[0].y, now, wasStale);
      return;
    }

    for (let index = 1; index < samples.length; index += 1) {
      const to = samples[index];
      if (renderTime > to.timestamp) continue;
      const from = samples[index - 1];
      const duration = to.timestamp - from.timestamp;
      if (duration <= 0 || duration > this.config.maximumSegmentDurationMs || distance(from, to) > this.config.teleportDistanceMeters) {
        this.apply(state, from.x, from.y, now, wasStale);
        return;
      }
      const progress = clamp((renderTime - from.timestamp) / duration, 0, 1);
      this.apply(
        state,
        from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress,
        now,
        wasStale,
      );
      return;
    }

    const latest = samples.at(-1)!;
    if (latest.positionSource === "REGION_CENTER" || samples.length < 2) {
      this.apply(state, latest.x, latest.y, now, wasStale);
      return;
    }
    const previous = samples.at(-2)!;
    const duration = latest.timestamp - previous.timestamp;
    if (duration <= 0 || duration > this.config.maximumSegmentDurationMs || distance(previous, latest) > this.config.teleportDistanceMeters) {
      this.apply(state, latest.x, latest.y, now, wasStale);
      return;
    }
    const extrapolationMs = clamp(renderTime - latest.timestamp, 0, this.config.maximumExtrapolationMs);
    this.apply(
      state,
      latest.x + ((latest.x - previous.x) / duration) * extrapolationMs,
      latest.y + ((latest.y - previous.y) / duration) * extrapolationMs,
      now,
      wasStale,
    );
  }

  private apply(
    state: InternalTagAnimationState,
    x: number,
    y: number,
    now: number,
    previousStale = state.stale,
  ): void {
    if (this.config.enabled) {
      const requestedDistance = distance({ x: state.renderedX, y: state.renderedY }, { x, y });
      const elapsedMs = Math.max(0, Math.min(100, now - state.lastRenderedAt));
      const maximumStep = this.config.maximumVisualSpeedMetersPerSecond * (elapsedMs / 1_000);
      if (requestedDistance > maximumStep && maximumStep > 0) {
        const ratio = maximumStep / requestedDistance;
        x = state.renderedX + (x - state.renderedX) * ratio;
        y = state.renderedY + (y - state.renderedY) * ratio;
      } else if (requestedDistance > 0 && maximumStep === 0) {
        return;
      }
    }
    if (this.displayArea && (!inDisplayArea({ x, y }, this.displayArea)
      || !segmentInDisplayArea({ x: state.renderedX, y: state.renderedY }, { x, y }, this.displayArea))) {
      // A non-routable relocation must never become a visible teleport. Keep the
      // last safe point until an interior sample supplies a traversable path.
      return;
    }
    const changed = x !== state.renderedX || y !== state.renderedY || previousStale !== state.stale;
    state.renderedX = x;
    state.renderedY = y;
    state.lastRenderedAt = now;
    if (changed) state.renderer?.render(x, y, state.stale, state.visualOpacity);
  }

  private startTransition(
    state: InternalTagAnimationState,
    destination: PositionSample,
    now: number,
    durationMs: number,
    kind: Transition["kind"],
  ): void {
    state.relocation = undefined;
    state.visualOpacity = 1;
    state.transition = {
      kind,
      fromX: state.renderedX,
      fromY: state.renderedY,
      toX: destination.x,
      toY: destination.y,
      startedAt: now,
      durationMs,
    };
  }

  private startNonRoutableRegionRelocation(
    state: InternalTagAnimationState,
    destination: PositionSample,
    now: number,
  ): void {
    state.transition = undefined;
    state.relocation = {
      kind: "non-routable-region-relocation",
      destination,
      startedAt: now,
      durationMs: clamp(this.config.regionTransitionDurationMs, 400, 800),
      snapped: false,
    };
    state.visualOpacity = 1;
  }

  private renderNonRoutableRegionRelocation(
    state: InternalTagAnimationState,
    now: number,
    wasStale: boolean,
  ): void {
    const relocation = state.relocation!;
    const progress = relocation.durationMs === 0 ? 1 : clamp((now - relocation.startedAt) / relocation.durationMs, 0, 1);
    if (progress < 0.5) {
      this.applyOpacity(state, 1 - progress * 2, now, wasStale);
      return;
    }
    if (!relocation.snapped) {
      // The destination was validated by ingest(). This is the only controlled
      // bypass of segment continuity: no intermediate spatial route is drawn.
      state.renderedX = relocation.destination.x;
      state.renderedY = relocation.destination.y;
      state.lastRenderedAt = now;
      state.relocationSequence += 1;
      relocation.snapped = true;
    }
    this.applyOpacity(state, (progress - 0.5) * 2, now, wasStale);
    if (progress >= 1) {
      state.visualOpacity = 1;
      state.samples = [relocation.destination];
      state.relocation = undefined;
    }
  }

  private applyOpacity(state: InternalTagAnimationState, opacity: number, now: number, previousStale: boolean): void {
    const nextOpacity = clamp(opacity, 0, 1);
    const changed = nextOpacity !== state.visualOpacity || previousStale !== state.stale;
    state.visualOpacity = nextOpacity;
    state.lastRenderedAt = now;
    if (changed) state.renderer?.render(state.renderedX, state.renderedY, state.stale, state.visualOpacity);
  }

  private transitionDuration(
    state: InternalTagAnimationState,
    destination: PositionSample,
    minimumDurationMs: number,
  ): number {
    const speedDuration = distance(
      { x: state.renderedX, y: state.renderedY },
      destination,
    ) / this.config.maximumVisualSpeedMetersPerSecond * 1_000;
    return clamp(
      Math.max(minimumDurationMs, speedDuration),
      minimumDurationMs,
      this.config.maximumTransitionDurationMs,
    );
  }

  private discardRenderedHistory(state: InternalTagAnimationState, renderTime: number): void {
    while (state.samples.length > 2 && state.samples[1].timestamp <= renderTime) state.samples.shift();
    this.trimToMaximumSize(state);
  }

  private trimToMaximumSize(state: InternalTagAnimationState): void {
    if (state.samples.length > this.config.maximumBufferSize) {
      state.samples.splice(0, state.samples.length - this.config.maximumBufferSize);
    }
  }
}
