import { useLayoutEffect, useMemo } from "react";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import { bindMapDisplayTracking } from "../services/bindMapDisplayTracking";
import { MapDisplayFilter } from "../services/MapDisplayFilter";
import type { PositionAnimationController } from "../services/PositionAnimationController";

export function useMapDisplayTracking(animation: PositionAnimationController, engineEnabled: boolean): void {
  const filter = useMemo(() => new MapDisplayFilter(animation, (mapTagDisplays) => {
    useIpsStore.setState({ mapTagDisplays });
  }), [animation]);

  useLayoutEffect(() => {
    return bindMapDisplayTracking(filter, engineEnabled);
  }, [engineEnabled, filter]);

  useLayoutEffect(() => () => {
    filter.dispose();
    useIpsStore.setState({ mapTagDisplays: {} });
  }, [filter]);
}
