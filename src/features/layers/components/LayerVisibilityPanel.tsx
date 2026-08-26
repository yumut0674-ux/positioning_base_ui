import { Eye, EyeOff, Layers3 } from "lucide-react";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import type { MapLayerId } from "@/src/features/map/types/map.types";

const LAYER_LABELS: Array<[MapLayerId, string]> = [
  ["floorPlan", "Kat planı"], ["grid", "Metrik ızgara"],
  ["tags", "Canlı Tag'ler"], ["routes", "Rota izi"], ["sensors", "Sensörler"],
];

export function LayerVisibilityPanel() {
  const layers = useIpsStore((state) => state.layers);
  const toggleLayer = useIpsStore((state) => state.toggleLayer);
  return (
    <section className="floating-panel layers-panel" aria-label="Katman görünürlüğü">
      <div className="panel-title"><span><Layers3 size={14} /> Katmanlar</span><small>05</small></div>
      <div className="layer-list">
        {LAYER_LABELS.map(([id, label]) => (
          <button key={id} onClick={() => toggleLayer(id)} className={layers[id] ? "is-visible" : ""}>
            <span className="layer-dot" />{label}{layers[id] ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
        ))}
      </div>
    </section>
  );
}
