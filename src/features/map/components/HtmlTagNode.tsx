import { memo, useLayoutEffect, useRef, type CSSProperties } from "react";
import type { TrackedTag } from "@/src/features/tracking/types/tracking.types";
import type { PositionAnimationController } from "@/src/features/tracking/services/PositionAnimationController";
import type { CoordinateTransformService } from "../services/CoordinateTransformService";
import { renderHtmlTagPosition } from "../services/htmlTagOverlay";
import styles from "./htmlTagOverlay.module.css";

interface HtmlTagNodeProps {
  readonly tag: TrackedTag;
  readonly transform: CoordinateTransformService;
  readonly positionAnimation: PositionAnimationController;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
}

function HtmlTagNodeComponent({ tag, transform, positionAnimation, selected, onSelect }: HtmlTagNodeProps) {
  const positionRef = useRef<HTMLDivElement>(null);
  const uncertain = tag.regionInference?.measurementKind === "uncertain";
  const estimated = tag.regionInference?.measurementKind === "estimated";
  const colorStyle = { color: tag.color, opacity: uncertain ? 0.5 : estimated ? 0.75 : 1 } satisfies CSSProperties;

  useLayoutEffect(() => positionAnimation.attach(tag.id, {
    render: (x, y, _stale, opacity) => {
      renderHtmlTagPosition(positionRef.current, transform, x, y);
      if (positionRef.current) positionRef.current.style.opacity = String(opacity);
    },
  }), [positionAnimation, tag.id, transform]);

  return (
    <div
      ref={positionRef}
      className={`${styles.position} ${selected ? styles.selectedPosition : ""}`}
      data-tag-id={tag.id}
    >
      <button
        type="button"
        className={`${styles.button} ${selected ? styles.selected : ""}`}
        style={colorStyle}
        aria-label={`${tag.name} (${tag.id}) etiketini seç`}
        aria-pressed={selected}
        title={tag.name}
        onClick={() => onSelect(tag.id)}
      >
        <span className={styles.selection} aria-hidden="true" />
        <span className={styles.halo} aria-hidden="true" />
        <span className={styles.marker} aria-hidden="true" />
        <span className={styles.core} aria-hidden="true" />
        {typeof tag.direction === "number" && (
          <span
            className={styles.direction}
            style={{ transform: `rotate(${tag.direction}deg)` }}
            aria-hidden="true"
          />
        )}
        <span className={styles.label}>{tag.name}</span>
      </button>
    </div>
  );
}

function sameVisualTag(previous: HtmlTagNodeProps, next: HtmlTagNodeProps): boolean {
  return previous.tag.id === next.tag.id
    && previous.tag.name === next.tag.name
    && previous.tag.color === next.tag.color
    && previous.tag.direction === next.tag.direction
    && previous.tag.regionInference?.measurementKind === next.tag.regionInference?.measurementKind
    && previous.transform === next.transform
    && previous.positionAnimation === next.positionAnimation
    && previous.selected === next.selected
    && previous.onSelect === next.onSelect;
}

export const HtmlTagNode = memo(HtmlTagNodeComponent, sameVisualTag);
