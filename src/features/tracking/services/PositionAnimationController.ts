import type {
  PositionAnimationConfig,
  PositionSample,
  TagAnimationState,
} from "../types/tracking.types";

export interface PositionRenderer {
  render(x: number, y: number, stale: boolean): void;
}

interface Transition {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly startedAt: number;
  readonly durationMs: number;
}

interface InternalTagAnimationState extends TagAnimationState {
  lastReceivedAt: number;
  lastRenderTime: number;
  renderer?: PositionRenderer;
  transition?: Transition;
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

export class PositionAnimationController {
  private readonly states = new Map<string, InternalTagAnimationState>();
  private readonly renderers = new Map<string, PositionRenderer>();

  public constructor(private config: PositionAnimationConfig) {}

  public setConfig(config: PositionAnimationConfig, now = Date.now()): void {
    this.config = config;
    if (config.enabled) return;
    for (const state of this.states.values()) {
      const latest = state.samples.at(-1);
      state.transition = undefined;
      if (!latest) continue;
      state.samples = [latest];
      this.apply(state, latest.x, latest.y, now);
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
      renderer.render(state.renderedX, state.renderedY, state.stale);
    }
    return () => {
      if (this.renderers.get(tagId) === renderer) this.renderers.delete(tagId);
      const current = this.states.get(tagId);
      if (current?.renderer === renderer) current.renderer = undefined;
    };
  }

  public ingest(tagId: string, incoming: IncomingAnimationPosition): void {
    if (!Number.isFinite(incoming.x) || !Number.isFinite(incoming.y)) return;
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
        lastReceivedAt: incoming.measurementTimestamp ?? receivedAt,
        lastRenderTime: Number.NEGATIVE_INFINITY,
        renderer: this.renderers.get(tagId),
      };
      this.states.set(tagId, state);
      state.renderer?.render(sample.x, sample.y, state.stale);
      return;
    }

    const latest = state.samples.at(-1);
    if (latest && sample.timestamp < latest.timestamp && (sample.positionSource === "REGION_CENTER" || latest.positionSource === "REGION_CENTER")) return;
    // Room coordinates are display anchors. Snap without inventing a wall-crossing route.
    if (sample.positionSource === "REGION_CENTER" || latest?.positionSource === "REGION_CENTER") {
      state.lastReceivedAt = incoming.measurementTimestamp ?? receivedAt;
      state.samples = [sample]; state.transition = undefined;
      state.stale = receivedAt - state.lastReceivedAt > this.config.stalePositionTimeoutMs;
      this.apply(state, sample.x, sample.y, receivedAt);
      return;
    }
    if (state.samples.some((item) => item.timestamp === sample.timestamp && samePosition(item, sample))) return;
    if (sample.timestamp <= state.lastRenderTime) return;

    state.lastReceivedAt = receivedAt;
    state.stale = false;

    if (!this.config.enabled) {
      state.samples = [sample];
      state.transition = undefined;
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
        this.startTransition(state, sample, receivedAt, this.config.teleportAnimationDurationMs);
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

      if (!state.renderer && now - state.lastReceivedAt > this.config.stalePositionTimeoutMs * 2) {
        this.states.delete(tagId);
        continue;
      }

      if (state.transition) {
        const transition = state.transition;
        const progress = transition.durationMs === 0
          ? 1
          : clamp((now - transition.startedAt) / transition.durationMs, 0, 1);
        this.apply(
          state,
          transition.fromX + (transition.toX - transition.fromX) * progress,
          transition.fromY + (transition.toY - transition.fromY) * progress,
          now,
          wasStale,
        );
        if (progress >= 1) state.transition = undefined;
        state.lastRenderTime = Math.max(state.lastRenderTime, renderTime);
        this.discardRenderedHistory(state, renderTime);
        continue;
      }

      this.renderTimeline(state, renderTime, now, wasStale);
      state.lastRenderTime = Math.max(state.lastRenderTime, renderTime);
      this.discardRenderedHistory(state, renderTime);
    }
  }

  public getState(tagId: string): Readonly<TagAnimationState> | undefined {
    return this.states.get(tagId);
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
    const changed = x !== state.renderedX || y !== state.renderedY || previousStale !== state.stale;
    state.renderedX = x;
    state.renderedY = y;
    state.lastRenderedAt = now;
    if (changed) state.renderer?.render(x, y, state.stale);
  }

  private startTransition(
    state: InternalTagAnimationState,
    destination: PositionSample,
    now: number,
    durationMs: number,
  ): void {
    state.transition = {
      fromX: state.renderedX,
      fromY: state.renderedY,
      toX: destination.x,
      toY: destination.y,
      startedAt: now,
      durationMs,
    };
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
