"use client";

import { useCallback, useMemo, useRef } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import useImage from "use-image";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import { useElementSize } from "@/src/shared/hooks/useElementSize";
import { DEMO_ANCHORS, DEMO_CALIBRATION, DEMO_FLOOR_PLAN } from "../config/demoMap";
import { CoordinateTransformService } from "../services/CoordinateTransformService";
import { TagNode } from "./TagNode";

const MIN_ZOOM = 0.38;
const MAX_ZOOM = 3.4;

export function MapViewport() {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const panOriginRef = useRef({ x: 0, y: 0 });
  const size = useElementSize(hostRef);
  const [floorImage] = useImage(DEMO_FLOOR_PLAN.imageUrl, "anonymous");
  const viewport = useIpsStore((state) => state.viewport);
  const layers = useIpsStore((state) => state.layers);
  const tagsById = useIpsStore((state) => state.tags);
  const tags = useMemo(() => Object.values(tagsById), [tagsById]);
  const selectedTagId = useIpsStore((state) => state.selectedTagId);
  const setViewport = useIpsStore((state) => state.setViewport);
  const selectTag = useIpsStore((state) => state.selectTag);
  const setCursorWorld = useIpsStore((state) => state.setCursorWorld);
  const transform = useMemo(() => new CoordinateTransformService(DEMO_CALIBRATION), []);

  const fitToScreen = useCallback(() => {
    const padding = 64;
    const scale = Math.min(
      (size.width - padding * 2) / DEMO_FLOOR_PLAN.canvasSize.width,
      (size.height - padding * 2) / DEMO_FLOOR_PLAN.canvasSize.height,
    );
    setViewport({
      scale,
      x: (size.width - DEMO_FLOOR_PLAN.canvasSize.width * scale) / 2,
      y: (size.height - DEMO_FLOOR_PLAN.canvasSize.height * scale) / 2,
    });
  }, [setViewport, size.height, size.width]);

  const handleWheel = useCallback((event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const direction = event.evt.deltaY > 0 ? -1 : 1;
    const nextScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.scale * Math.pow(1.08, direction)));
    const mapPoint = {
      x: (pointer.x - viewport.x) / viewport.scale,
      y: (pointer.y - viewport.y) / viewport.scale,
    };
    setViewport({
      scale: nextScale,
      x: pointer.x - mapPoint.x * nextScale,
      y: pointer.y - mapPoint.y * nextScale,
    });
  }, [setViewport, viewport]);

  const updatePointer = useCallback(() => {
    const pointer = stageRef.current?.getPointerPosition();
    if (pointer) setCursorWorld(transform.screenToWorld(pointer, viewport));
  }, [setCursorWorld, transform, viewport]);

  const gridLines = useMemo(() => {
    const lines: React.ReactNode[] = [];
    const step = transform.metersToPixels(1);
    for (let x = 0; x <= DEMO_FLOOR_PLAN.canvasSize.width; x += step) {
      lines.push(<Line key={`x-${x}`} points={[x, 0, x, DEMO_FLOOR_PLAN.canvasSize.height]} stroke="#8ab4c8" strokeWidth={x % (step * 5) === 0 ? 0.8 : 0.35} opacity={0.34} />);
    }
    for (let y = 0; y <= DEMO_FLOOR_PLAN.canvasSize.height; y += step) {
      lines.push(<Line key={`y-${y}`} points={[0, y, DEMO_FLOOR_PLAN.canvasSize.width, y]} stroke="#8ab4c8" strokeWidth={y % (step * 5) === 0 ? 0.8 : 0.35} opacity={0.34} />);
    }
    return lines;
  }, [transform]);

  const mapGroupProps = { x: viewport.x, y: viewport.y, scaleX: viewport.scale, scaleY: viewport.scale };

  return (
    <div ref={hostRef} className="map-viewport" data-testid="map-viewport">
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        onWheel={handleWheel}
        onMouseMove={updatePointer}
        onMouseLeave={() => setCursorWorld(null)}
        draggable
        x={0}
        y={0}
        onDragStart={() => { panOriginRef.current = { x: viewport.x, y: viewport.y }; }}
        onDragEnd={(event) => {
          setViewport({
            ...viewport,
            x: panOriginRef.current.x + event.target.x(),
            y: panOriginRef.current.y + event.target.y(),
          });
          event.target.position({ x: 0, y: 0 });
        }}
      >
        <Layer listening={false} visible={layers.grid}><Group {...mapGroupProps}>{gridLines}</Group></Layer>
        <Layer listening={false} visible={layers.floorPlan}>
          <Group {...mapGroupProps}>
            <Rect width={1280} height={720} fill="#eef5f7" />
            {floorImage && <KonvaImage image={floorImage} width={1280} height={720} opacity={0.9} />}
            <Rect width={1280} height={720} fill="#d8f5f0" opacity={0.08} />
          </Group>
        </Layer>
        <Layer listening={false} visible={layers.references}>
          <Group {...mapGroupProps}>
            <Line points={[0, 720, 150, 720]} stroke="#00a896" strokeWidth={2} />
            <Text x={8} y={690} text="5 m" fill="#087f73" fontSize={12} fontFamily="monospace" />
          </Group>
        </Layer>
        <Layer listening={false} visible={layers.anchors}>
          <Group {...mapGroupProps}>
            {DEMO_ANCHORS.map((anchor) => {
              const point = transform.worldToCanvas(anchor);
              return <Group key={anchor.id} x={point.x} y={point.y}><Circle radius={9} fill="#ffffff" stroke="#3578e5" strokeWidth={2} /><Circle radius={2.5} fill="#3578e5" /><Text x={12} y={-6} text={anchor.id} fill="#395d8a" fontSize={9} fontFamily="monospace" /></Group>;
            })}
          </Group>
        </Layer>
        <Layer listening={false} visible={layers.sensors}><Group {...mapGroupProps} /></Layer>
        <Layer visible={layers.tags}>
          <Group {...mapGroupProps}>
            {tags.map((tag) => <TagNode key={tag.id} tag={tag} transform={transform} selected={tag.id === selectedTagId} onSelect={selectTag} />)}
          </Group>
        </Layer>
        <Layer listening={false} visible={layers.routes}>
          <Group {...mapGroupProps}>
            <Line points={[260, 486, 334, 473, 407, 498, 471, 478]} stroke="#00a896" strokeWidth={1.5} opacity={0.46} dash={[5, 8]} tension={0.35} />
          </Group>
        </Layer>
        <Layer listening={false} visible={layers.selection}><Group {...mapGroupProps} /></Layer>
        <Layer listening={false}>
          <Group x={18} y={size.height - 38}>
            <Rect width={182} height={24} fill="#ffffff" opacity={0.9} cornerRadius={4} stroke="#c4d4df" />
            <Text x={10} y={7} text="WORLD CRS  ·  METERS" fill="#60758d" fontSize={9} fontFamily="monospace" />
          </Group>
        </Layer>
      </Stage>
      <div className="canvas-actions" aria-label="Map controls">
        <button onClick={() => setViewport({ x: 42, y: 36, scale: 0.82 })} title="Reset view">RESET</button>
        <button onClick={fitToScreen} title="Fit map to viewport">FIT</button>
      </div>
      <div className="zoom-readout">{Math.round(viewport.scale * 100)}%</div>
    </div>
  );
}
