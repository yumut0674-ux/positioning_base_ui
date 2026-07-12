import { useEffect, useMemo } from "react";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import { MockTrackingGateway } from "../services/TrackingGateway";
import { ExponentialMovingAverageFilter } from "../services/positionFilters";

export function useRealtimeTracking(): void {
  const upsertTag = useIpsStore((state) => state.upsertTag);
  const gateway = useMemo(() => new MockTrackingGateway(), []);
  const filter = useMemo(() => new ExponentialMovingAverageFilter(), []);

  useEffect(() => gateway.connect((incoming) => {
    const current = useIpsStore.getState().tags[incoming.id];
    if (!current) return upsertTag(incoming);
    const position = filter.next(current, incoming);
    upsertTag({ ...incoming, ...position });
  }), [filter, gateway, upsertTag]);
}
