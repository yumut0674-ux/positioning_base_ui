import { CircleGauge, Clock3, Database } from "lucide-react";
import { useMemo } from "react";
import { useFps } from "@/src/shared/hooks/useFps";
import { useIpsStore } from "../store/useIpsStore";

export function StatusStrip() {
  const fps = useFps();
  const tagsById = useIpsStore((state) => state.tags);
  const tagCount = useMemo(() => Object.keys(tagsById).length, [tagsById]);
  return (
    <footer className="status-strip">
      <div><Database size={12} /><span>{tagCount} TAKİP ETİKETİ AKIŞTA</span></div>
      <div><CircleGauge size={12} /><span>GÖRÜNTÜLEME</span><strong>{fps} FPS</strong></div>
      <div className="status-clock"><Clock3 size={12} /><strong>{new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</strong><span>UTC+3</span></div>
    </footer>
  );
}
