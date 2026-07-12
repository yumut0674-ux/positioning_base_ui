import { memo, useEffect, useRef } from "react";
import { Circle, Group, Line, Rect, Text } from "react-konva";
import type Konva from "konva";
import type { TrackedTag } from "@/src/features/tracking/types/tracking.types";
import type { CoordinateTransformService } from "../services/CoordinateTransformService";

interface TagNodeProps {
  readonly tag: TrackedTag;
  readonly transform: CoordinateTransformService;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
}

function TagNodeComponent({ tag, transform, selected, onSelect }: TagNodeProps) {
  const groupRef = useRef<Konva.Group>(null);
  const position = transform.worldToCanvas(tag);

  useEffect(() => {
    groupRef.current?.to({ x: position.x, y: position.y, duration: 0.72, easing: (t) => 1 - Math.pow(1 - t, 3) });
  }, [position.x, position.y]);

  return (
    <Group
      ref={groupRef}
      x={position.x}
      y={position.y}
      onClick={() => onSelect(tag.id)}
      onTap={() => onSelect(tag.id)}
    >
      {selected && <Circle radius={20} stroke={tag.color} strokeWidth={1} opacity={0.42} dash={[4, 3]} />}
      <Circle radius={13} fill={tag.color} opacity={0.13} />
      <Circle radius={6.5} fill={tag.color} shadowColor={tag.color} shadowBlur={12} />
      <Circle radius={2.3} fill="#07120f" />
      {typeof tag.direction === "number" && (
        <Line
          points={[0, -9, 0, -17]}
          stroke={tag.color}
          strokeWidth={1.5}
          rotation={tag.direction}
          lineCap="round"
        />
      )}
      <Group x={12} y={-26}>
        <Rect width={88} height={30} fill="#0b111d" opacity={0.94} cornerRadius={4} stroke="#273143" strokeWidth={1} />
        <Text x={8} y={6} width={74} text={tag.id} fill="#e8edf6" fontSize={10} fontStyle="bold" fontFamily="Inter, sans-serif" />
        <Text x={8} y={18} width={74} text={`${tag.x.toFixed(2)}, ${tag.y.toFixed(2)} m`} fill="#78869c" fontSize={8} fontFamily="monospace" />
      </Group>
    </Group>
  );
}

export const TagNode = memo(TagNodeComponent);
