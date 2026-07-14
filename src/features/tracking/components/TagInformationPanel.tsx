import { BatteryMedium, Box, LocateFixed, Radio, Route } from "lucide-react";
import { motion } from "framer-motion";
import { useIpsStore } from "@/src/app/store/useIpsStore";

export function TagInformationPanel() {
  const selectedTag = useIpsStore((state) => state.selectedTagId ? state.tags[state.selectedTagId] : undefined);
  if (!selectedTag) return null;
  return (
    <motion.aside className="tag-panel" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }}>
      <div className="tag-panel-header">
        <div className="tag-icon" style={{ color: selectedTag.color }}><Box size={19} /></div>
        <div><small>İZLENEN VARLIK</small><h2>{selectedTag.name}</h2></div>
        <span className="live-pill"><i /> CANLI</span>
      </div>
      <div className="tag-identity"><code>{selectedTag.id}</code><span>{selectedTag.status === "active" ? "aktif" : selectedTag.status === "idle" ? "beklemede" : selectedTag.status}</span></div>
      <div className="tag-position">
        <div><small>X KONUMU</small><strong>{selectedTag.x.toFixed(2)}</strong><span>metre</span></div>
        <div><small>Y KONUMU</small><strong>{selectedTag.y.toFixed(2)}</strong><span>metre</span></div>
      </div>
      <div className="tag-metrics">
        <div><BatteryMedium size={15} /><span>Pil</span><strong>{selectedTag.battery}%</strong></div>
        <div><Radio size={15} /><span>Sinyal</span><strong>-62 dBm</strong></div>
        <div><LocateFixed size={15} /><span>Doğruluk</span><strong>± 0.18 m</strong></div>
      </div>
      <div className="activity-block">
        <div><span>Son hareketlilik</span><small>SON 30 SN</small></div>
        <div className="sparkline" aria-label="Son hareket sinyali">
          {[28, 44, 35, 62, 48, 76, 54, 83, 66, 74, 59, 88, 72, 92].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
        </div>
      </div>
      <button className="route-button"><Route size={15} /> Rota geçmişini aç <span>↗</span></button>
    </motion.aside>
  );
}
