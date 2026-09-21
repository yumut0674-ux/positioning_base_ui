import { memo, useEffect, useMemo, useState } from "react";
import type { TrackedTag } from "@/src/features/tracking/types/tracking.types";
import type { PositionAnimationController } from "@/src/features/tracking/services/PositionAnimationController";
import { appendTagTrailPoint, pruneTagTrail, type TagTrailPoint } from "@/src/features/tracking/services/tagTrail";
import type { CoordinateTransformService } from "../services/CoordinateTransformService";
import styles from "./htmlTagOverlay.module.css";

const TRAIL_SAMPLE_INTERVAL_MS = 160;

interface TrailSnapshot {
  readonly now: number;
  readonly trails: Readonly<Record<string, readonly TagTrailPoint[]>>;
}

interface TagTrailLayerProps {
  readonly width: number;
  readonly height: number;
  readonly tags: readonly TrackedTag[];
  readonly transform: CoordinateTransformService;
  readonly positionAnimation: PositionAnimationController;
  readonly durationMs: number;
}

function TagTrailLayerComponent({ width, height, tags, transform, positionAnimation, durationMs }: TagTrailLayerProps) {
  const tagKey = useMemo(() => tags.map((tag) => tag.id).sort().join("\u0000"), [tags]);
  const colors = useMemo(() => new Map(tags.map((tag) => [tag.id, tag.color])), [tags]);
  const [snapshot, setSnapshot] = useState<TrailSnapshot>({ now: 0, trails: {} });

  useEffect(() => {
    const visibleIds = new Set(tags.map((tag) => tag.id));
    const sample = () => {
      const now = Date.now();
      setSnapshot((current) => {
        const next: Record<string, readonly TagTrailPoint[]> = {};
        for (const tagId of visibleIds) {
          const existing = pruneTagTrail(current.trails[tagId] ?? [], now, durationMs);
          const state = positionAnimation.getState(tagId);
          if (!state || state.stale || !Number.isFinite(state.renderedX) || !Number.isFinite(state.renderedY)) {
            if (existing.length > 0) next[tagId] = existing;
            continue;
          }
          const source = state.samples.at(-1)?.positionSource ?? "RAW";
          next[tagId] = appendTagTrailPoint(existing, {
            x: state.renderedX,
            y: state.renderedY,
            source,
          }, now, durationMs);
        }
        return { now, trails: next };
      });
    };
    sample();
    const timer = window.setInterval(sample, TRAIL_SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [durationMs, positionAnimation, tagKey, tags]);

  return (
    <svg
      className={styles.trailLayer}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {Object.entries(snapshot.trails).flatMap(([tagId, points]) => points.slice(1).map((point, index) => {
        const previous = points[index];
        if (previous.segment !== point.segment) return null;
        const from = transform.worldToCanvas(previous);
        const to = transform.worldToCanvas(point);
        const freshness = Math.max(0, 1 - ((snapshot.now - point.at) / durationMs));
        return (
          <line
            key={`${tagId}-${point.at}-${index}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={colors.get(tagId) ?? "#00a896"}
            strokeWidth={2.4 + freshness * 1.8}
            strokeLinecap="round"
            opacity={0.06 + freshness * 0.58}
            vectorEffect="non-scaling-stroke"
          />
        );
      }))}
    </svg>
  );
}

export const TagTrailLayer = memo(TagTrailLayerComponent);
