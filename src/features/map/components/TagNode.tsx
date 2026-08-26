import { memo, useLayoutEffect, useRef } from "react";
import { Circle, Group, Line, Rect, Text } from "react-konva";
import type Konva from "konva";
import type { TrackedTag } from "@/src/features/tracking/types/tracking.types";
import type { CoordinateTransformService } from "../services/CoordinateTransformService";
import type { PositionAnimationController } from "@/src/features/tracking/services/PositionAnimationController";

interface TagNodeProps {
  readonly tag: TrackedTag;
  readonly transform: CoordinateTransformService;
  readonly positionAnimation: PositionAnimationController;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
}

function TagNodeComponent({ tag, transform, positionAnimation, selected, onSelect }: TagNodeProps) {
  const groupRef = useRef<Konva.Group>(null);

  useLayoutEffect(() => positionAnimation.attach(tag.id, {
    render: (x, y) => {
      const point = transform.worldToCanvas({ x, y });
      groupRef.current?.position(point);
      groupRef.current?.getLayer()?.batchDraw();
    },
  }), [positionAnimation, tag.id, transform]);

  return (
    <Group
      ref={groupRef}
      onClick={() => onSelect(tag.id)}
      onTap={() => onSelect(tag.id)}
    >
      {selected && <Circle radius={20} stroke={tag.color} strokeWidth={1} opacity={0.42} dash={[4, 3]} />}
      <Circle radius={13} fill={tag.color} opacity={0.13} />
      <Circle radius={6.5} fill={tag.color} shadowColor={tag.color} shadowBlur={12} />
      <Circle radius={2.3} fill="#ffffff" />
      {typeof tag.direction === "number" && (
        <Line
          points={[0, -9, 0, -17]}
          stroke={tag.color}
          strokeWidth={1.5}
          rotation={tag.direction}
          lineCap="round"
        />
      )}
      <Group x={12} y={-19}>
        <Rect width={88} height={20} fill="#ffffff" opacity={0.96} cornerRadius={4} stroke="#c6d5e1" strokeWidth={1} shadowColor="#506780" shadowBlur={10} shadowOpacity={0.12} />
        <Text x={8} y={5} width={74} text={tag.id} fill="#162133" fontSize={10} fontStyle="bold" fontFamily="Inter, sans-serif" />
      </Group>
    </Group>
  );
}

export const TagNode = memo(TagNodeComponent);
