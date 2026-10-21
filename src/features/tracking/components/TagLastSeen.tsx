import type { TagPresenceState } from "../types/tagPresence.types";
import { lastDataAgeLabel, lastObservedLocationLabel } from "../services/tagPresencePresentation";

export function TagLastSeen({ presence, now }: { readonly presence?: TagPresenceState; readonly now: number }) {
  if (!presence) return <span className="tag-last-seen-empty">Henüz veri alınmadı</span>;
  return <span className="tag-last-seen"><strong>{lastObservedLocationLabel(presence)}</strong>
    {presence.hiddenForNoData && <em className="tag-reliability-warning">Güvenilir değil</em>}
    <small>Son veri: {lastDataAgeLabel(presence, now)}{presence.hiddenForNoData ? " · Haritada gizli" : ""}</small>
  </span>;
}
