import type { AreaEventType } from "@/src/server/regionEngine/AreaTransitionEngine";

export const AREA_EVENT_LABELS: Record<AreaEventType, string> = {
  AREA_ENTERED: "Alana girdi",
  AREA_EXITED_OBSERVED: "Alandan çıktı — gözlemlendi",
  AREA_EXITED_ESTIMATED: "Alandan çıktı — tahmini",
  AREA_EXITED_FLOOR_INFERRED: "Alandan çıktı — kat değişiminden çıkarıldı",
};
export const AREA_EVENT_TYPES = Object.keys(AREA_EVENT_LABELS) as AreaEventType[];
