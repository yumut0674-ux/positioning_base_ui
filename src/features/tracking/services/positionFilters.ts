import type { PositionFilter } from "../types/tracking.types";

export class PassthroughPositionFilter implements PositionFilter {
  public next(_: { x: number; y: number }, incoming: { x: number; y: number }) {
    return incoming;
  }
}

export class ExponentialMovingAverageFilter implements PositionFilter {
  public constructor(private readonly alpha = 0.42) {}

  public next(current: { x: number; y: number }, incoming: { x: number; y: number }) {
    return {
      x: current.x + (incoming.x - current.x) * this.alpha,
      y: current.y + (incoming.y - current.y) * this.alpha,
    };
  }
}
