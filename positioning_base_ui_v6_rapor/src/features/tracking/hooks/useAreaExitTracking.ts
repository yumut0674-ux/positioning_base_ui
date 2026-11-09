import { useEffect } from "react";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import type { AreaExitReadSnapshot, AreaExitReadStatus } from "../types/areaExit.types";
import { PassiveAreaExitLookup, type PassiveExitRequest } from "../services/passiveAreaExitLookup";

export function useAreaExitTracking(): void {
  useEffect(() => {
    const abort = new AbortController();
    const lookup = new PassiveAreaExitLookup();
    const refresh = async (requests: readonly PassiveExitRequest[]) => {
      try {
        for (let offset = 0; offset < requests.length; offset += 200) {
          const batch = requests.slice(offset, offset + 200);
          const params = new URLSearchParams();
          for (const request of batch) params.append("tag", request.tagCode);
          const response = await fetch(`/api/tracking/area-exits?${params}`, { signal: abort.signal, cache: "no-store" });
          if (!response.ok) throw new Error("Exit history unavailable");
          const snapshot = await response.json() as AreaExitReadSnapshot;
          if (!Number.isFinite(snapshot.serverNow) || !snapshot.byTag || typeof snapshot.byTag !== "object") throw new Error("Invalid exit history");
          if (abort.signal.aborted) return;
          const current = useIpsStore.getState();
          const now = Date.now() + current.presenceClockOffset;
          const byTag: Record<string, AreaExitReadStatus> = {};
          for (const request of batch) {
            if (lookup.isCurrent(current.tagPresenceById[request.tagCode], request, now) && snapshot.byTag[request.tagCode])
              byTag[request.tagCode] = snapshot.byTag[request.tagCode];
          }
          current.applyAreaExitSnapshot({ byTag, serverNow: snapshot.serverNow });
        }
      } catch {
        // No background retry loop. A new observation/passive episode may request history again.
      }
    };
    const sync = () => {
      const state = useIpsStore.getState();
      const requests = lookup.select(state.tagPresenceById, Date.now() + state.presenceClockOffset);
      if (requests.length) void refresh(requests);
    };
    // The existing activity/presence stream supplies transitions; this hook creates no polling timer.
    const unsubscribe = useIpsStore.subscribe(sync);
    sync();
    return () => { abort.abort(); unsubscribe(); };
  }, []);
}
