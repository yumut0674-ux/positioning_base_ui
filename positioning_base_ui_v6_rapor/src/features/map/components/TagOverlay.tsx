import { memo, useMemo, type CSSProperties } from "react";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import type { PositionAnimationController } from "@/src/features/tracking/services/PositionAnimationController";
import type { TrackedTag } from "@/src/features/tracking/types/tracking.types";
import type { ViewportState } from "../types/map.types";
import type { CoordinateTransformService } from "../services/CoordinateTransformService";
import { htmlTagViewportTransform } from "../services/htmlTagOverlay";
import { HtmlTagNode } from "./HtmlTagNode";
import { TagTrailLayer } from "./TagTrailLayer";
import styles from "./htmlTagOverlay.module.css";
import { tagActivityPresentation } from "@/src/features/tracking/services/tagActivityPresentation";
import { useTagPresenceClock } from "@/src/features/tracking/hooks/useTagPresenceClock";
import { withLatestTagObservation } from "@/src/features/tracking/services/tagQuickList";

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
  const displays = useIpsStore((state) => state.mapTagDisplays);
  const presenceById = useIpsStore((state) => state.tagPresenceById);
  const observedTags = useIpsStore((state) => state.observedTags);
  const now = useTagPresenceClock();
  const config = useIpsStore((state) => state.regionsConfig);
  const activeMapId = useIpsStore((state) => state.activeMapId);
  const trailSettings = useIpsStore((state) => state.tagTrailSettings);
  const hasArea = !!config?.regions.length && (!activeMapId || config.map.mapId === activeMapId);
  const visibleTags = useMemo(() => tags.filter((tag) => displays[tag.id]?.visible), [displays, tags]);
  const worldStyle = {
    width,
    height,
    transform: htmlTagViewportTransform(viewport),
  } satisfies CSSProperties;

  return (
    <div className={styles.overlay} hidden={!visible} aria-hidden={!visible} data-testid="tag-overlay">
      <div className={styles.world} style={worldStyle}>
        {visible && hasArea && trailSettings.enabled && (
          <TagTrailLayer
            width={width}
            height={height}
            tags={visibleTags}
            transform={transform}
            positionAnimation={positionAnimation}
            durationMs={trailSettings.durationMs}
          />
        )}
        {visible && hasArea && visibleTags.map((tag) => (
          <HtmlTagNode
            key={tag.id}
            tag={tag}
            liveColor={tagActivityPresentation(withLatestTagObservation(tag, observedTags[tag.id]), presenceById[tag.id], now).isLiveColor}
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
