import { useEffect } from "react";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import type { TagPresenceSnapshot, TagPresenceUpdate } from "../types/tagPresence.types";

export function useTagPresenceTracking(): void {
  useEffect(() => {
    const source = new EventSource("/api/tracking/presence");
    source.addEventListener("snapshot", event => {
      try {
        const snapshot = JSON.parse((event as MessageEvent<string>).data) as TagPresenceSnapshot;
        if (typeof snapshot.epoch === "string" && Number.isFinite(snapshot.serverNow) && Array.isArray(snapshot.states))
          useIpsStore.getState().applyTagPresenceSnapshot(snapshot);
      } catch { /* A reconnect supplies a complete snapshot. */ }
    });
    source.addEventListener("presence", event => {
      try {
        const update = JSON.parse((event as MessageEvent<string>).data) as TagPresenceUpdate;
        if (update.state?.tagCode && Number.isFinite(update.state.revision)) useIpsStore.getState().applyTagPresenceUpdate(update);
      } catch { /* Ignore malformed stream events. */ }
    });
    source.addEventListener("status", event => {
      try {
        const status = JSON.parse((event as MessageEvent<string>).data) as { warning: string | null; serverNow: number };
        useIpsStore.setState({ presenceWarning: status.warning, presenceClockOffset: status.serverNow - Date.now() });
      } catch { /* Next heartbeat refreshes status. */ }
    });
    source.onerror = () => useIpsStore.setState({ presenceConnection: "reconnecting" });
    return () => source.close();
  }, []);
}
