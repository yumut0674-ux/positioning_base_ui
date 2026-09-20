import type { Point2D } from "@/src/shared/types/geometry";
import type { PositionFilter } from "../types/tracking.types";

export interface AdaptivePositionFilterConfig {
  /** Hareket yokken UWB olcum gurultusunu tamamen bastiran yaricap. */
  readonly jitterRadiusMeters: number;
  /** Yavas harekette uygulanan EMA katsayisi. */
  readonly smoothingAlpha: number;
  /** Gercek harekette gecikmeyi azaltan ust EMA katsayisi. */
  readonly movingAlpha: number;
  /** movingAlpha degerine ulasilan mesafe. */
  readonly movingDistanceMeters: number;
  /** Bu hizdan daha hizli tekil olcumler once dogrulanir. */
  readonly maximumSpeedMetersPerSecond: number;
  /** Kucuk zaman araliklarinda hiz kontrolunun baslayacagi en az mesafe. */
  readonly outlierMinimumDistanceMeters: number;
  /** Ardışık aykiri olcumlerin ayni hareketi dogrulamis sayilacagi yaricap. */
  readonly outlierConfirmationRadiusMeters: number;
  /** Uzun veri bosluklarinda hiz tahmini guvenilmez oldugu icin kontrolu kapatir. */
  readonly speedCheckMaximumGapMs: number;
}

export const DEFAULT_ADAPTIVE_POSITION_FILTER_CONFIG: AdaptivePositionFilterConfig = {
  jitterRadiusMeters: 0.18,
  smoothingAlpha: 0.32,
  movingAlpha: 0.68,
  movingDistanceMeters: 1.5,
  maximumSpeedMetersPerSecond: 4.5,
  outlierMinimumDistanceMeters: 1.2,
  outlierConfirmationRadiusMeters: 1.25,
  speedCheckMaximumGapMs: 2_000,
};

interface TimedPoint extends Point2D {
  readonly timestamp: number;
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

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

/**
 * Harita sunumuna ozel, tag basina kullanilan durumlu filtre.
 *
 * - Sabit duran tag'in kucuk UWB titresimlerini bir dead-band icinde tutar.
 * - Hareket hizlandikca EMA katsayisini arttirip gereksiz goruntu gecikmesini azaltir.
 * - Fiziksel olarak gercekci olmayan tek bir sivri olcumu ikinci olcume kadar bekletir.
 *
 * Kaynak olcumleri degistirmez; yalnizca ekranda kullanilacak noktayi dondurur.
 */
export class AdaptivePositionFilter {
  private lastMeasurement?: TimedPoint;
  private pendingOutlier?: TimedPoint;

  public constructor(
    private readonly config: AdaptivePositionFilterConfig = DEFAULT_ADAPTIVE_POSITION_FILTER_CONFIG,
  ) {}

  public reset(point?: Point2D, timestamp = 0): void {
    this.lastMeasurement = point ? { ...point, timestamp } : undefined;
    this.pendingOutlier = undefined;
  }

  public next(current: Point2D, incoming: Point2D, timestamp: number): Point2D {
    if (!Number.isFinite(incoming.x) || !Number.isFinite(incoming.y)) return current;
    const measuredAt = Number.isFinite(timestamp) ? timestamp : (this.lastMeasurement?.timestamp ?? 0);
    const nextMeasurement = { ...incoming, timestamp: measuredAt };
    const previous = this.lastMeasurement;

    if (previous) {
      const elapsedMs = measuredAt - previous.timestamp;
      const travelled = distance(previous, incoming);
      const speed = elapsedMs > 0 ? travelled / (elapsedMs / 1_000) : 0;
      const suspicious = elapsedMs > 0
        && elapsedMs <= this.config.speedCheckMaximumGapMs
        && travelled >= this.config.outlierMinimumDistanceMeters
        && speed > this.config.maximumSpeedMetersPerSecond;

      if (suspicious) {
        const pending = this.pendingOutlier;
        const confirmed = !!pending
          && measuredAt > pending.timestamp
          && distance(pending, incoming) <= this.config.outlierConfirmationRadiusMeters;
        if (!confirmed) {
          this.pendingOutlier = nextMeasurement;
          return current;
        }
      }
    }

    this.lastMeasurement = nextMeasurement;
    this.pendingOutlier = undefined;
    const displacement = distance(current, incoming);
    if (displacement <= this.config.jitterRadiusMeters) return current;

    const motion = clamp01(
      (displacement - this.config.jitterRadiusMeters)
      / Math.max(Number.EPSILON, this.config.movingDistanceMeters - this.config.jitterRadiusMeters),
    );
    const alpha = this.config.smoothingAlpha
      + (this.config.movingAlpha - this.config.smoothingAlpha) * motion;
    return {
      x: current.x + (incoming.x - current.x) * alpha,
      y: current.y + (incoming.y - current.y) * alpha,
    };
  }
}
