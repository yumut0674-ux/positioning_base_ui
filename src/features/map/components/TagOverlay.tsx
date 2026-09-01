import { memo, type CSSProperties } from "react";
import type { PositionAnimationController } from "@/src/features/tracking/services/PositionAnimationController";
import type { TrackedTag } from "@/src/features/tracking/types/tracking.types";
import type { ViewportState } from "../types/map.types";
import type { CoordinateTransformService } from "../services/CoordinateTransformService";
import { htmlTagViewportTransform } from "../services/htmlTagOverlay";
import { HtmlTagNode } from "./HtmlTagNode";
import styles from "./htmlTagOverlay.module.css";

interface TagOverlayProps {
  readonly width: number;
  readonly height: number;
  readonly viewport: ViewportState;
  readonly tags: readonly TrackedTag[];
  readonly transform: CoordinateTransformService;
  readonly positionAnimation: PositionAnimationController;
  readonly selectedTagId: string | null;
  readonly visible: boolean;
  readonly onSelect: (id: string) => void;
}

function TagOverlayComponent({
  width,
  height,
  viewport,
  tags,
  transform,
  positionAnimation,
  selectedTagId,
  visible,
  onSelect,
}: TagOverlayProps) {
  const worldStyle = {
    width,
    height,
    transform: htmlTagViewportTransform(viewport),
  } satisfies CSSProperties;

  return (
    <div className={styles.overlay} hidden={!visible} aria-hidden={!visible} data-testid="tag-overlay">
      <div className={styles.world} style={worldStyle}>
        {visible && tags.map((tag) => (
          <HtmlTagNode
            key={tag.id}
            tag={tag}
            transform={transform}
            positionAnimation={positionAnimation}
            selected={tag.id === selectedTagId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

export const TagOverlay = memo(TagOverlayComponent);
