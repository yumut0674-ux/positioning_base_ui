"use client";

import { memo, useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { zoomHistoryViewport, type HistoryViewport } from "../services/historyMapViewport";
import styles from "./routeHistoryPanel.module.css";

interface Props {
  readonly src?: string;
  readonly highlightSrc?: string;
  readonly width: number;
  readonly height: number;
  readonly viewport: HistoryViewport;
  readonly onViewportChange: (viewport: HistoryViewport) => void;
}
type Pointer = { readonly x: number; readonly y: number };
type Gesture = { readonly viewport: HistoryViewport; readonly center: Pointer; readonly distance: number };

/** Pan/zoom only updates one compositor transform; React commits when the gesture ends. */
export const RouteHistoryImageViewport = memo(function RouteHistoryImageViewport({ src, highlightSrc, width, height, viewport, onViewportChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef(viewport);
  const pointersRef = useRef(new Map<number, Pointer>());
  const gestureRef = useRef<Gesture | null>(null);
  const frameRef = useRef(0);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const apply = useCallback((next: HistoryViewport) => {
    currentRef.current = next;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      if (imageRef.current) imageRef.current.style.transform = `translate3d(${next.x}px,${next.y}px,0) scale(${next.scale})`;
    });
  }, []);

  useEffect(() => {
    currentRef.current = viewport;
    cancelAnimationFrame(frameRef.current);
    if (imageRef.current) imageRef.current.style.transform = `translate3d(${viewport.x}px,${viewport.y}px,0) scale(${viewport.scale})`;
  }, [viewport]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const current = currentRef.current;
      const next = zoomHistoryViewport(current, pointer, current.scale * Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .002));
      apply(next);
      clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = setTimeout(() => onViewportChange(currentRef.current), 120);
    };
    host.addEventListener("wheel", wheel, { passive: false });
    return () => { host.removeEventListener("wheel", wheel); clearTimeout(wheelTimerRef.current); cancelAnimationFrame(frameRef.current); };
  }, [onViewportChange, apply]);

  const position = (event: ReactPointerEvent<HTMLDivElement>): Pointer => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const geometry = () => {
    const [a, b] = [...pointersRef.current.values()];
    return { center: b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a,
      distance: b ? Math.hypot(b.x - a.x, b.y - a.y) : 0 };
  };
  const beginGesture = () => {
    gestureRef.current = pointersRef.current.size ? { viewport: currentRef.current, ...geometry() } : null;
  };
  const endPointer = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!pointersRef.current.delete(event.pointerId)) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    beginGesture();
    if (!pointersRef.current.size || cancelled) onViewportChange(currentRef.current);
  };

  return <div ref={hostRef} className={styles.imageViewport} tabIndex={0} role="region" aria-label="Rota haritası. Sürükleyerek taşıyın, tekerlek veya iki parmakla yakınlaştırın."
    onPointerDown={event => {
      if (event.button !== 0) return;
      clearTimeout(wheelTimerRef.current);
      event.currentTarget.setPointerCapture(event.pointerId);
      pointersRef.current.set(event.pointerId, position(event));
      beginGesture();
    }}
    onPointerMove={event => {
      if (!pointersRef.current.has(event.pointerId) || !gestureRef.current) return;
      pointersRef.current.set(event.pointerId, position(event));
      const gesture = gestureRef.current, now = geometry();
      const scaled = zoomHistoryViewport(gesture.viewport, gesture.center, gesture.distance > 0 ? gesture.viewport.scale * now.distance / gesture.distance : gesture.viewport.scale);
      apply({ ...scaled, x: scaled.x + now.center.x - gesture.center.x, y: scaled.y + now.center.y - gesture.center.y });
    }}
    onPointerUp={event => endPointer(event, false)} onPointerCancel={event => endPointer(event, true)} onLostPointerCapture={event => endPointer(event, true)}
    onDoubleClick={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      const next = zoomHistoryViewport(currentRef.current, { x: event.clientX - rect.left, y: event.clientY - rect.top }, currentRef.current.scale * 1.5);
      apply(next); onViewportChange(next);
    }}
    onKeyDown={event => {
      const current = currentRef.current;
      const movement: Record<string, Pointer> = { ArrowLeft: { x: 60, y: 0 }, ArrowRight: { x: -60, y: 0 }, ArrowUp: { x: 0, y: 60 }, ArrowDown: { x: 0, y: -60 } };
      const delta = movement[event.key];
      let next: HistoryViewport;
      if (delta) next = { ...current, x: current.x + delta.x, y: current.y + delta.y };
      else if (["+", "=", "-"].includes(event.key)) next = zoomHistoryViewport(current, { x: event.currentTarget.clientWidth / 2, y: event.currentTarget.clientHeight / 2 }, current.scale * (event.key === "-" ? .8 : 1.25));
      else return;
      event.preventDefault(); apply(next); onViewportChange(next);
    }}>
    <div ref={imageRef} className={styles.imageTransform} style={{ width, height }}>
      {/* Raster images have fixed floor coordinates; next/image would alter their intrinsic layout. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} width={width} height={height} alt="Rota geçmişi ve kat planı" draggable={false} className={styles.historyMapImage} style={{ opacity: highlightSrc ? .35 : 1 }} />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {highlightSrc && <img src={highlightSrc} width={width} height={height} alt="Seçili konum aralığı" draggable={false} className={styles.historyMapHighlight} />}
    </div>
    {!src && <span className={styles.mapEmpty}>Rota haritası için geçmiş sorgulayın.</span>}
  </div>;
});
