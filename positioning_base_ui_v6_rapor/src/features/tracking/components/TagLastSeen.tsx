import type { TagPresenceState } from "../types/tagPresence.types";
import { lastDataAgeLabel, lastObservedLocationLabel } from "../services/tagPresencePresentation";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import { tagActivityPresentation } from "../services/tagActivityPresentation";

export function TagLastSeen({ presence, now }: { readonly presence?: TagPresenceState; readonly now: number }) {
  const exit = useIpsStore(state => presence ? state.areaExitByTag[presence.tagCode] : undefined);
  if (!presence) return <span className="tag-last-seen-empty">Henüz veri alınmadı</span>;
  return <span className="tag-last-seen"><strong>{lastObservedLocationLabel(presence, exit, tagActivityPresentation(undefined, presence, now).activity === "offline")}</strong>
    {presence.hiddenForNoData && <em className="tag-reliability-warning">Güvenilir değil</em>}
    <small>Son veri: {lastDataAgeLabel(presence, now)}{presence.hiddenForNoData ? " · Haritada gizli" : ""}</small>
  </span>;
}
