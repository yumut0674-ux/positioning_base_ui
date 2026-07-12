import { useEffect, useState, type RefObject } from "react";
import type { Size2D } from "../types/geometry";

export function useElementSize(ref: RefObject<HTMLElement | null>): Size2D {
  const [size, setSize] = useState<Size2D>({ width: 1, height: 1 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
