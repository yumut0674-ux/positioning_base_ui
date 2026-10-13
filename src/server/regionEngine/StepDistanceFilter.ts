import type { StepDistanceFilterSettings } from "../../features/regions/types/region.types";
import type { TrackingPosition } from "../trackingBuffer";

interface Candidate { first: TrackingPosition; last: TrackingPosition; count: number }
export interface StepDistanceTrace {
  readonly distanceMeters: number;
  readonly maximumDistanceMeters: number;
  readonly reference: { readonly x: number; readonly y: number; readonly measuredAt: string };
  readonly candidateCount: number;
  readonly candidateDurationMs: number;
  readonly requiredCount: number;
  readonly requiredDurationMs: number;
  readonly referenceReset: boolean;
  readonly usedAsRoomEvidence: false;
}
interface Gates {
  readonly speedOK: boolean;
  readonly fresh: boolean;
  readonly qualityOK: boolean;
  readonly maximumSpeedMetersPerSecond: number;
  readonly movementToleranceMeters: number;
}
interface Result { readonly outcome: "accept" | "reject" | "reset"; readonly trace?: StepDistanceTrace }
const distance = (a: TrackingPosition, b: TrackingPosition) => Math.hypot(a.x - b.x, a.y - b.y);

/** One instance per tag/map. Ordered, finite inputs are enforced by the engine. */
export class StepDistanceFilter {
  public reference: TrackingPosition | null;
  private candidate: Candidate | null = null;

  public constructor(reference: TrackingPosition | null) { this.reference = reference; }
  public reset(reference: TrackingPosition | null = null): void { this.reference = reference; this.candidate = null; }
  public clearCandidate(): void { this.candidate = null; }
  public expire(now: number, maximumGapMs: number): void {
    if (this.candidate && now - Date.parse(this.candidate.last.timestamp) > maximumGapMs) this.candidate = null;
  }

  public evaluate(raw: TrackingPosition, settings: StepDistanceFilterSettings, gates: Gates): Result {
    const reference = this.reference;
    const travelled = reference ? distance(reference, raw) : 0;
    const tooFar = travelled > settings.maximumStepDistanceMeters;
    if (!gates.fresh || !gates.qualityOK || (!tooFar && !gates.speedOK)) {
      this.candidate = null;
      return { outcome: "reject", ...(tooFar && reference ? { trace: this.trace(reference, travelled, settings, 0, 0, false) } : {}) };
    }
    if (!reference || !tooFar) { this.reset(raw); return { outcome: "accept" }; }

    const at = Date.parse(raw.timestamp), previous = this.candidate;
    const gap = previous ? at - Date.parse(previous.last.timestamp) : 0;
    const duration = previous ? at - Date.parse(previous.first.timestamp) : 0;
    const step = previous ? distance(previous.last, raw) : 0;
    const coherent = previous && gap > 0 && gap <= settings.relocationMaximumGapMs
      && duration <= settings.relocationCandidateWindowMs
      && distance(previous.first, raw) <= settings.relocationClusterRadiusMeters
      && step <= settings.maximumStepDistanceMeters
      && step <= gates.maximumSpeedMetersPerSecond * gap / 1000 + gates.movementToleranceMeters;
    const candidate = this.candidate = coherent
      ? { first: previous.first, last: raw, count: Math.min(previous.count + 1, settings.relocationConfirmationCount) }
      : { first: raw, last: raw, count: 1 };
    const span = at - Date.parse(candidate.first.timestamp);
    const confirmed = candidate.count >= settings.relocationConfirmationCount && span >= settings.relocationConfirmationDurationMs;
    const trace = this.trace(reference, travelled, settings, candidate.count, span, confirmed);
    if (confirmed) this.reset(raw);
    return { outcome: confirmed ? "reset" : "reject", trace };
  }

  private trace(reference: TrackingPosition, travelled: number, settings: StepDistanceFilterSettings, count: number, duration: number, reset: boolean): StepDistanceTrace {
    return { distanceMeters: travelled, maximumDistanceMeters: settings.maximumStepDistanceMeters,
      reference: { x: reference.x, y: reference.y, measuredAt: reference.timestamp },
      candidateCount: count, candidateDurationMs: duration, requiredCount: settings.relocationConfirmationCount,
      requiredDurationMs: settings.relocationConfirmationDurationMs, referenceReset: reset, usedAsRoomEvidence: false };
  }
}
