import { CircleGauge, Clock3, CloudCog, Database } from "lucide-react";
import { useMemo } from "react";
import { useFps } from "@/src/shared/hooks/useFps";
import { useIpsStore } from "../store/useIpsStore";

export function StatusStrip() {
  const fps = useFps();
  const tagsById = useIpsStore((state) => state.tags);
  const tagCount = useMemo(() => Object.keys(tagsById).length, [tagsById]);
  return (
    <footer className="status-strip">
      <div><span className="status-online"><i /> SİMÜLASYON BAĞLANTISI</span><small>24 ms gecikme</small></div>
      <div><Database size={12} /><span>{tagCount} TAG AKIŞTA</span></div>
      <div><CloudCog size={12} /><span>SON EŞİTLEME</span><strong>ŞİMDİ</strong></div>
      <div><CircleGauge size={12} /><span>GÖRÜNTÜLEME</span><strong>{fps} FPS</strong></div>
      <div className="status-clock"><Clock3 size={12} /><strong>{new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</strong><span>UTC+3</span></div>
    </footer>
  );
}
