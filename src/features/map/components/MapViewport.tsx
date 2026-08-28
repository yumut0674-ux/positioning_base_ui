"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import useImage from "use-image";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import { useElementSize } from "@/src/shared/hooks/useElementSize";
import {
  constrainMapViewport,
  getFittedMapViewport,
  isAtFittedScale,
  MAP_CALIBRATION,
  MAP_FLOOR_PLAN,
  MAP_VIEWPORT_LIMITS,
} from "../config/mapConfig";
import { CoordinateTransformService } from "../services/CoordinateTransformService";
import { TagNode } from "./TagNode";
import type { PositionAnimationController } from "@/src/features/tracking/services/PositionAnimationController";

export function MapViewport({ positionAnimation }: { readonly positionAnimation: PositionAnimationController }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const panOriginRef = useRef({ x: 0, y: 0 });
  const pinchRef = useRef<{ readonly distance: number; readonly center: { readonly x: number; readonly y: number }; readonly viewport: typeof viewport } | null>(null);
  const handledFocusRequestRef = useRef(0);
  const handledFitRequestRef = useRef(0);
  const hasUserAdjustedViewRef = useRef(false);
  const lastAutoFitSizeRef = useRef<{ width: number; height: number } | null>(null);
  const size = useElementSize(hostRef);
  const [floorImage] = useImage(MAP_FLOOR_PLAN.imageUrl, "anonymous");
  const viewport = useIpsStore((state) => state.viewport);
  const layers = useIpsStore((state) => state.layers);
  const tagsById = useIpsStore((state) => state.tags);
  const tags = useMemo(() => Object.values(tagsById), [tagsById]);
  const selectedTagId = useIpsStore((state) => state.selectedTagId);
  const setViewport = useIpsStore((state) => state.setViewport);
  const selectTagAndFocus = useIpsStore((state) => state.selectTagAndFocus);
  const measurement = useIpsStore((state) => state.measurement);
  const setMeasurementPoint = useIpsStore((state) => state.setMeasurementPoint);
  const cancelMeasurement = useIpsStore((state) => state.cancelMeasurement);
  const mapFocusRequest = useIpsStore((state) => state.mapFocusRequest);
  const mapFitRequest = useIpsStore((state) => state.mapFitRequest);
  const transform = useMemo(() => new CoordinateTransformService(MAP_CALIBRATION), []);
  const fittedViewport = useMemo(() => getFittedMapViewport(size), [size]);
  const canPan = Boolean(fittedViewport && !measurement.enabled && !isAtFittedScale(viewport, fittedViewport));

  const constrainViewport = useCallback((nextViewport: typeof viewport) => constrainMapViewport(nextViewport, size), [size]);

  const fitToScreen = useCallback(() => {
    const fittedViewport = getFittedMapViewport(size);
    if (!fittedViewport) return false;
    hasUserAdjustedViewRef.current = false;
    pinchRef.current = null;
    setViewport(fittedViewport);
    return true;
  }, [setViewport, size]);

  useEffect(() => {
    if (hasUserAdjustedViewRef.current) return;
    if (lastAutoFitSizeRef.current?.width === size.width && lastAutoFitSizeRef.current?.height === size.height) return;

    // Sidebar and window transitions can emit several intermediate dimensions.
    // Fit once the panel has settled, but never overwrite a pan or zoom.
    const timer = window.setTimeout(() => {
      if (hasUserAdjustedViewRef.current || !fitToScreen()) return;
      lastAutoFitSizeRef.current = { width: size.width, height: size.height };
    }, 180);
    return () => window.clearTimeout(timer);
  }, [fitToScreen, size.height, size.width]);

  useEffect(() => {
    if (mapFocusRequest === 0 || mapFocusRequest === handledFocusRequestRef.current) return;
    if (size.width <= 0 || size.height <= 0) return;
    handledFocusRequestRef.current = mapFocusRequest;
    const selectedTag = selectedTagId ? tagsById[selectedTagId] : undefined;
    if (!selectedTag) {
      fitToScreen();
      return;
    }

    const scale = Math.min(MAP_VIEWPORT_LIMITS.maxZoom, Math.max(viewport.scale, 1.4));
    const point = transform.worldToCanvas(selectedTag);
    hasUserAdjustedViewRef.current = true;
    setViewport(constrainViewport({
      scale,
      x: size.width / 2 - point.x * scale,
      y: size.height / 2 - point.y * scale,
    }));
  }, [constrainViewport, fitToScreen, mapFocusRequest, selectedTagId, setViewport, size.height, size.width, tagsById, transform, viewport.scale]);

  useEffect(() => {
    if (mapFitRequest === 0 || mapFitRequest === handledFitRequestRef.current) return;
    handledFitRequestRef.current = mapFitRequest;
    fitToScreen();
  }, [fitToScreen, mapFitRequest]);

  useEffect(() => {
    if (!measurement.enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelMeasurement();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancelMeasurement, measurement.enabled]);

  const handleWheel = useCallback((event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const direction = event.evt.deltaY > 0 ? -1 : 1;
    hasUserAdjustedViewRef.current = true;
    // On a narrow screen the fitted plan can legitimately be below the normal
    // zoom floor. Keep that scale reachable so the first wheel gesture never
    // makes an otherwise contained plan jump outside the panel.
    const fittedScale = fittedViewport?.scale ?? MAP_VIEWPORT_LIMITS.minZoom;
    const minimumScale = Math.min(MAP_VIEWPORT_LIMITS.minZoom, fittedScale);
    const nextScale = Math.min(
      MAP_VIEWPORT_LIMITS.maxZoom,
      Math.max(
        minimumScale,
        viewport.scale * Math.pow(MAP_VIEWPORT_LIMITS.wheelZoomFactor, direction),
      ),
    );
    if (fittedViewport && nextScale <= fittedViewport.scale + 0.001) {
      fitToScreen();
      return;
    }
    const mapPoint = {
      x: (pointer.x - viewport.x) / viewport.scale,
      y: (pointer.y - viewport.y) / viewport.scale,
    };
    setViewport(constrainViewport({
      scale: nextScale,
      x: pointer.x - mapPoint.x * nextScale,
      y: pointer.y - mapPoint.y * nextScale,
    }));
  }, [constrainViewport, fitToScreen, fittedViewport, setViewport, viewport]);

  const createPinch = useCallback((event: TouchEvent) => {
    const stage = stageRef.current;
    if (!stage || event.touches.length !== 2) return null;
    const [firstTouch, secondTouch] = [event.touches[0], event.touches[1]];
    const bounds = stage.container().getBoundingClientRect();
    const center = {
      x: (firstTouch.clientX + secondTouch.clientX) / 2 - bounds.left,
      y: (firstTouch.clientY + secondTouch.clientY) / 2 - bounds.top,
    };
    return {
      center,
      distance: Math.hypot(firstTouch.clientX - secondTouch.clientX, firstTouch.clientY - secondTouch.clientY),
      viewport,
    };
  }, [viewport]);

  const handleTouchStart = useCallback((event: Konva.KonvaEventObject<TouchEvent>) => {
    if (event.evt.touches.length === 2 && !measurement.enabled) pinchRef.current = createPinch(event.evt);
  }, [createPinch, measurement.enabled]);

  const handleTouchMove = useCallback((event: Konva.KonvaEventObject<TouchEvent>) => {
    if (measurement.enabled || event.evt.touches.length !== 2) return;
    const pinch = pinchRef.current ?? createPinch(event.evt);
    if (!pinch || pinch.distance === 0) return;
    pinchRef.current = pinch;
    event.evt.preventDefault();
    const nextScale = Math.min(MAP_VIEWPORT_LIMITS.maxZoom, Math.max(
      Math.min(MAP_VIEWPORT_LIMITS.minZoom, fittedViewport?.scale ?? MAP_VIEWPORT_LIMITS.minZoom),
      pinch.viewport.scale * (createPinch(event.evt)?.distance ?? pinch.distance) / pinch.distance,
    ));
    if (fittedViewport && nextScale <= fittedViewport.scale + 0.001) {
      fitToScreen();
      return;
    }
    const mapPoint = {
      x: (pinch.center.x - pinch.viewport.x) / pinch.viewport.scale,
      y: (pinch.center.y - pinch.viewport.y) / pinch.viewport.scale,
    };
    hasUserAdjustedViewRef.current = true;
    setViewport(constrainViewport({
      scale: nextScale,
      x: pinch.center.x - mapPoint.x * nextScale,
      y: pinch.center.y - mapPoint.y * nextScale,
    }));
  }, [constrainViewport, createPinch, fitToScreen, fittedViewport, measurement.enabled, setViewport]);

  const handleTouchEnd = useCallback(() => {
    pinchRef.current = null;
  }, []);

  const handleMeasureClick = useCallback(() => {
    if (!measurement.enabled) return;
    const pointer = stageRef.current?.getPointerPosition();
    if (pointer) setMeasurementPoint(transform.screenToWorld(pointer, viewport));
  }, [measurement.enabled, setMeasurementPoint, transform, viewport]);

  const gridLines = useMemo(() => {
    const lines: React.ReactNode[] = [];
    const step = transform.metersToPixels(1);
    for (let x = 0; x <= MAP_FLOOR_PLAN.canvasSize.width; x += step) {
      lines.push(<Line key={`x-${x}`} points={[x, 0, x, MAP_FLOOR_PLAN.canvasSize.height]} stroke="#8ab4c8" strokeWidth={x % (step * 5) === 0 ? 0.8 : 0.35} opacity={0.34} />);
    }
    for (let y = 0; y <= MAP_FLOOR_PLAN.canvasSize.height; y += step) {
      lines.push(<Line key={`y-${y}`} points={[0, y, MAP_FLOOR_PLAN.canvasSize.width, y]} stroke="#8ab4c8" strokeWidth={y % (step * 5) === 0 ? 0.8 : 0.35} opacity={0.34} />);
    }
    return lines;
  }, [transform]);

  const mapGroupProps = { x: viewport.x, y: viewport.y, scaleX: viewport.scale, scaleY: viewport.scale };
  const measurementStart = measurement.start ? transform.worldToCanvas(measurement.start) : null;
  const measurementEnd = measurement.end ? transform.worldToCanvas(measurement.end) : null;
  const measurementDistance = measurement.start && measurement.end
    ? Math.hypot(measurement.end.x - measurement.start.x, measurement.end.y - measurement.start.y)
    : null;
  const measurementLabel = measurementStart && measurementEnd
    ? { x: (measurementStart.x + measurementEnd.x) / 2, y: (measurementStart.y + measurementEnd.y) / 2 }
    : null;

  return (
    <div ref={hostRef} className="map-viewport" data-testid="map-viewport" data-can-pan={canPan}>
      <Stage
        ref={stageRef}
        // Konva creates an internal canvas for every layer. It cannot draw to
        // a zero-sized canvas while ResizeObserver is waiting for the first
        // measurement, so retain a harmless 1px backing canvas until then.
        width={Math.max(1, size.width)}
        height={Math.max(1, size.height)}
        onWheel={handleWheel}
        onClick={handleMeasureClick}
        onTap={handleMeasureClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        preventDefault={false}
        draggable={canPan}
        x={0}
        y={0}
        dragBoundFunc={(position) => {
          const constrained = constrainViewport({
            ...viewport,
            x: viewport.x + position.x,
            y: viewport.y + position.y,
          });
          return { x: constrained.x - viewport.x, y: constrained.y - viewport.y };
        }}
        onDragStart={() => {
          hasUserAdjustedViewRef.current = true;
          panOriginRef.current = { x: viewport.x, y: viewport.y };
        }}
        onDragEnd={(event) => {
          setViewport(constrainViewport({
            ...viewport,
            x: panOriginRef.current.x + event.target.x(),
            y: panOriginRef.current.y + event.target.y(),
          }));
          event.target.position({ x: 0, y: 0 });
        }}
      >
        <Layer listening={false} visible={layers.grid}><Group {...mapGroupProps}>{gridLines}</Group></Layer>
        <Layer listening={false} visible={layers.floorPlan}>
          <Group {...mapGroupProps}>
            <Rect width={MAP_FLOOR_PLAN.canvasSize.width} height={MAP_FLOOR_PLAN.canvasSize.height} fill="#eef5f7" />
            {floorImage && <KonvaImage image={floorImage} width={MAP_FLOOR_PLAN.canvasSize.width} height={MAP_FLOOR_PLAN.canvasSize.height} opacity={0.9} />}
            <Rect width={MAP_FLOOR_PLAN.canvasSize.width} height={MAP_FLOOR_PLAN.canvasSize.height} fill="#d8f5f0" opacity={0.08} />
          </Group>
        </Layer>
        <Layer listening={false} visible={layers.references}>
          <Group {...mapGroupProps}>
            <Line points={[0, MAP_FLOOR_PLAN.canvasSize.height, transform.metersToPixels(5), MAP_FLOOR_PLAN.canvasSize.height]} stroke="#00a896" strokeWidth={2} />
            <Text x={8} y={MAP_FLOOR_PLAN.canvasSize.height - 30} text="5 m" fill="#087f73" fontSize={12} fontFamily="monospace" />
          </Group>
        </Layer>
        <Layer listening={false} visible={layers.sensors}><Group {...mapGroupProps} /></Layer>
        <Layer visible={layers.tags}>
          <Group {...mapGroupProps}>
            {tags.map((tag) => <TagNode key={tag.id} tag={tag} transform={transform} positionAnimation={positionAnimation} selected={tag.id === selectedTagId} onSelect={selectTagAndFocus} />)}
          </Group>
        </Layer>
        <Layer listening={false} visible={layers.routes}>
          <Group {...mapGroupProps}>
            <Line points={[260, 486, 334, 473, 407, 498, 471, 478]} stroke="#00a896" strokeWidth={1.5} opacity={0.46} dash={[5, 8]} tension={0.35} />
          </Group>
        </Layer>
        <Layer listening={false} visible={layers.selection}><Group {...mapGroupProps} /></Layer>
        <Layer listening={false}>
          <Group {...mapGroupProps}>
            {measurementStart && <Circle x={measurementStart.x} y={measurementStart.y} radius={6 / viewport.scale} fill="#ffffff" stroke="#f29f05" strokeWidth={2 / viewport.scale} />}
            {measurementStart && measurementEnd && <>
              <Line points={[measurementStart.x, measurementStart.y, measurementEnd.x, measurementEnd.y]} stroke="#f29f05" strokeWidth={2 / viewport.scale} dash={[7 / viewport.scale, 5 / viewport.scale]} />
              <Circle x={measurementEnd.x} y={measurementEnd.y} radius={6 / viewport.scale} fill="#ffffff" stroke="#f29f05" strokeWidth={2 / viewport.scale} />
            </>}
          </Group>
          {measurementLabel && measurementDistance !== null && <Group x={viewport.x + measurementLabel.x * viewport.scale} y={viewport.y + measurementLabel.y * viewport.scale - 18}>
            <Rect x={-31} y={-11} width={62} height={22} fill="#fffdf6" stroke="#e7a536" cornerRadius={4} shadowColor="#506780" shadowBlur={8} shadowOpacity={0.12} />
            <Text x={-27} y={-4} width={54} align="center" text={`${measurementDistance.toFixed(1)} m`} fill="#9a5b00" fontSize={10} fontStyle="bold" fontFamily="monospace" />
          </Group>}
        </Layer>
      </Stage>
      <div className="zoom-readout">{Math.round(viewport.scale * 100)}%</div>
    </div>
  );
}
