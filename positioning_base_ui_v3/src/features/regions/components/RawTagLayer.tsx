import { Circle, Group, Layer, Line, Rect, Text } from "react-konva";
import type { RawTagMarker } from "../services/rawTagPresentation";
import { formatRawTagAge } from "../services/rawTagPresentation";

interface RawTagLayerProps {
  readonly markers: readonly RawTagMarker[];
  readonly viewport: { readonly x: number; readonly y: number; readonly scale: number };
}

const MARKER_COLOR = "#d9468d";
const STALE_COLOR = "#a86b88";
const MIN_SCALE = 0.05;

export function RawTagLayer({ markers, viewport }: RawTagLayerProps) {
  const markerScale = 1 / Math.max(MIN_SCALE, Math.abs(viewport.scale));
  return (
    <Layer listening={false}>
      <Group x={viewport.x} y={viewport.y} scaleX={viewport.scale} scaleY={viewport.scale} listening={false}>
        {markers.map((marker) => {
          const color = marker.stale ? STALE_COLOR : MARKER_COLOR;
          const ageLabel = marker.stale
            ? `HAM · ESKİ · ${formatRawTagAge(marker.ageMs)}`
            : `HAM · ${formatRawTagAge(marker.ageMs)}`;
          return (
            <Group
              key={marker.id}
              x={marker.pixel.x}
              y={marker.pixel.y}
              scaleX={markerScale}
              scaleY={markerScale}
              opacity={marker.stale ? 0.56 : 1}
              listening={false}
            >
              <Line points={[-13, 0, 13, 0]} stroke={color} strokeWidth={1.4} dash={[3, 3]} />
              <Line points={[0, -13, 0, 13]} stroke={color} strokeWidth={1.4} dash={[3, 3]} />
              <Circle radius={10} stroke={color} strokeWidth={2} dash={[4, 3]} fill="rgba(255,255,255,0.18)" />
              <Circle radius={3.2} fill={color} stroke="#ffffff" strokeWidth={1} />
              <Group x={15} y={-25}>
                <Rect width={166} height={50} cornerRadius={5} fill="rgba(31, 23, 38, 0.9)" stroke={color} strokeWidth={1} />
                <Text x={7} y={5} width={152} height={12} text={marker.id} fill="#ffffff" fontSize={10} fontStyle="bold" ellipsis wrap="none" />
                <Text x={7} y={20} width={152} text={`X ${marker.world.x.toFixed(3)} · Y ${marker.world.y.toFixed(3)}`} fill="#f2dce8" fontSize={9} />
                <Text x={7} y={34} width={152} text={ageLabel} fill={color} fontSize={9} fontStyle="bold" />
              </Group>
            </Group>
          );
        })}
      </Group>
    </Layer>
  );
}
