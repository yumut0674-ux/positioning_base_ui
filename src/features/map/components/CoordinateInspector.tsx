import { Crosshair, ScanLine } from "lucide-react";
import { useIpsStore } from "@/src/app/store/useIpsStore";

export function CoordinateInspector() {
  const cursor = useIpsStore((state) => state.cursorWorld);
  return (
    <section className="floating-panel coordinate-panel" aria-label="Koordinat denetçisi">
      <div className="panel-eyebrow"><Crosshair size={13} /> Koordinat denetçisi</div>
      <div className="coordinate-values">
        <div><span>X</span><strong>{cursor ? cursor.x.toFixed(2) : "--.--"}</strong><small>m</small></div>
        <div><span>Y</span><strong>{cursor ? cursor.y.toFixed(2) : "--.--"}</strong><small>m</small></div>
      </div>
      <div className="coordinate-footer"><ScanLine size={12} /> EPSG · YEREL METRİK</div>
    </section>
  );
}
