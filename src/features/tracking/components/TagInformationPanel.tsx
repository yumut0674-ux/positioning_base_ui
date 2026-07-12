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
        <div><small>TRACKED ASSET</small><h2>{selectedTag.name}</h2></div>
        <span className="live-pill"><i /> LIVE</span>
      </div>
      <div className="tag-identity"><code>{selectedTag.id}</code><span>{selectedTag.status}</span></div>
      <div className="tag-position">
        <div><small>X POSITION</small><strong>{selectedTag.x.toFixed(2)}</strong><span>meters</span></div>
        <div><small>Y POSITION</small><strong>{selectedTag.y.toFixed(2)}</strong><span>meters</span></div>
      </div>
      <div className="tag-metrics">
        <div><BatteryMedium size={15} /><span>Battery</span><strong>{selectedTag.battery}%</strong></div>
        <div><Radio size={15} /><span>Signal</span><strong>-62 dBm</strong></div>
        <div><LocateFixed size={15} /><span>Accuracy</span><strong>± 0.18 m</strong></div>
      </div>
      <div className="activity-block">
        <div><span>Recent activity</span><small>LAST 30 SEC</small></div>
        <div className="sparkline" aria-label="Recent movement signal">
          {[28, 44, 35, 62, 48, 76, 54, 83, 66, 74, 59, 88, 72, 92].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
        </div>
      </div>
      <button className="route-button"><Route size={15} /> Open route history <span>↗</span></button>
    </motion.aside>
  );
}
