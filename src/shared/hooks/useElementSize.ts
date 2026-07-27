import { useEffect, useState, type RefObject } from "react";
import type { Size2D } from "../types/geometry";

export function useElementSize(ref: RefObject<HTMLElement | null>): Size2D {
  const [size, setSize] = useState<Size2D>({ width: 1, height: 1 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let animationFrame = 0;
    const updateSize = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        setSize({ width: rect.width, height: rect.height });
      });
    };
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    window.addEventListener("resize", updateSize);
    document.addEventListener("fullscreenchange", updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSize);
      document.removeEventListener("fullscreenchange", updateSize);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [ref]);

  return size;
}
