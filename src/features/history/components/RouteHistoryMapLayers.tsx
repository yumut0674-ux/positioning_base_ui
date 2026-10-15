"use client";

import { memo } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Shape, Text } from "react-konva";

interface Props {
  readonly image?: HTMLImageElement;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly points: number[];
  readonly selectedPoints: number[];
  readonly selected: boolean;
  readonly showRoute: boolean;
}

/** A single canvas path draws all dots, avoiding thousands of Konva/React nodes. */
const PointCloud = memo(function PointCloud({ points, radius, opacity }: { points: number[]; radius: number; opacity: number }) {
  return <Shape fill="#ffffff" stroke="#00a896" strokeWidth={1.3} opacity={opacity} perfectDrawEnabled={false} sceneFunc={(context, shape) => {
    context.beginPath();
    for (let i = 0; i < points.length; i += 2) {
      context.moveTo(points[i] + radius, points[i + 1]);
      context.arc(points[i], points[i + 1], radius, 0, Math.PI * 2);
    }
    context.fillStrokeShape(shape);
  }} />;
});

export const RouteHistoryMapLayers = memo(function RouteHistoryMapLayers({ image, width, height, scale, points, selectedPoints, selected, showRoute }: Props) {
  return <>
    <Layer listening={false}><Group scaleX={scale} scaleY={scale}>
      <Rect width={width} height={height} fill="#e7f0f4" />
      {image && <KonvaImage image={image} width={width} height={height} opacity={.68} />}
      <Rect width={width} height={height} fill="#d8f5f0" opacity={.1} />
      {Array.from({ length: Math.ceil(width / 80) + 1 }, (_, index) => <Line key={`v-${index}`} points={[index * 80, 0, index * 80, height]} stroke="#6f9db1" strokeWidth={.4} opacity={.16} />)}
      {Array.from({ length: Math.ceil(height / 80) + 1 }, (_, index) => <Line key={`h-${index}`} points={[0, index * 80, width, index * 80]} stroke="#6f9db1" strokeWidth={.4} opacity={.16} />)}
    </Group></Layer>
    <Layer listening={false}><Group scaleX={scale} scaleY={scale}>
      {showRoute && points.length >= 4 && <>
        <Line points={points} stroke="#00a896" strokeWidth={10} opacity={selected ? .06 : .15} lineCap="round" lineJoin="round" perfectDrawEnabled={false} />
        <Line points={points} stroke="#3578e5" strokeWidth={3.5} opacity={selected ? .2 : .95} lineCap="round" lineJoin="round" perfectDrawEnabled={false} />
      </>}
      <PointCloud points={points} radius={2.8} opacity={selected ? .3 : .95} />
      {showRoute && selectedPoints.length >= 4 && <Line points={selectedPoints} stroke="#00a896" strokeWidth={5} lineCap="round" lineJoin="round" perfectDrawEnabled={false} />}
      <PointCloud points={selectedPoints} radius={3.2} opacity={1} />
      {selectedPoints.length >= 2 && <>
        <Circle x={selectedPoints[0]} y={selectedPoints[1]} radius={6} fill="#13a875" stroke="#ffffff" strokeWidth={2} />
        <Circle x={selectedPoints.at(-2)} y={selectedPoints.at(-1)} radius={6} fill="#3578e5" stroke="#ffffff" strokeWidth={2} />
      </>}
      {points.length >= 2 && <>
        <Group x={points[0]} y={points[1]}><Circle radius={14} fill="#21d497" opacity={.19} /><Circle radius={7} fill="#13a875" stroke="#ffffff" strokeWidth={2} /><Text x={15} y={-5} text="BAŞLANGIÇ" fill="#087f73" fontSize={10} fontStyle="bold" fontFamily="Inter, sans-serif" /></Group>
        <Group x={points.at(-2)} y={points.at(-1)}><Circle radius={16} fill="#f35166" opacity={.19} /><Circle radius={8} fill="#e65353" stroke="#ffffff" strokeWidth={2} /><Text x={16} y={-5} text="BİTİŞ" fill="#bd3e4b" fontSize={10} fontStyle="bold" fontFamily="Inter, sans-serif" /></Group>
      </>}
    </Group></Layer>
  </>;
});
