import type { TagPresenceState } from "../types/tagPresence.types";
import { formatLocationDuration } from "./tagPanelState";
import type { AreaExitReadStatus, ArchivedAreaExit } from "../types/areaExit.types";
import type { RegionsConfig } from "../../regions/types/region.types";
import type { TrackedTag } from "../types/tracking.types";
import { roomDecisionLabel } from "./roomDecisionLabel";

function areaExitLabel(areaName: string, gateName?: string | null, exitedAt?: string | null): string {
  const at = new Date(exitedAt ?? "");
  const options = { timeZone: "Europe/Istanbul" };
  const timestamp = Number.isFinite(at.getTime())
    ? `${at.toLocaleDateString("tr-TR", { ...options, day: "2-digit", month: "2-digit", year: "numeric" })} ${at.toLocaleTimeString("tr-TR", { ...options, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}`
    : "";
  return `${areaName} alanından çıktı${gateName ? ` (${gateName})` : ""}${timestamp ? ` · ${timestamp}` : ""}`;
}

/** UI text only; keep the shared decision label used by tracking and notifications unchanged. */
export function tagLocationLabel(tag: TrackedTag, config?: RegionsConfig | null, now = Date.now()): string {
  const decision = tag.regionInference;
  if ((tag.mapId || tag.mapId === undefined) && decision?.enabled && decision.outsideArea) {
    const matchingConfig = tag.mapId && config?.map.mapId !== tag.mapId ? null : config;
    return areaExitLabel(matchingConfig?.largeAreas?.[0]?.name ?? "Alan", decision.leftAreaGate, decision.leftAreaAt);
  }
  return roomDecisionLabel(tag, config, now);
}

export function visibleAreaExit(presence: TagPresenceState | undefined, status: AreaExitReadStatus | undefined): ArchivedAreaExit | undefined {
  const live = presence?.processed;
  const decision = live?.regionInference;
  // Reuse the decision already delivered by the normal tracking stream, even after no-data hiding.
  if (presence && live && live.mapId && live.mapId === presence.raw.mapId && decision?.enabled && decision.outsideArea
    && Number.isFinite(Date.parse(decision.leftAreaAt ?? ""))) {
    return { tagCode: presence.tagCode, mapId: live.mapId,
      areaName: presence.lastObservedLocation.mapName ?? presence.lastObservedLocation.floorLabel ?? live.mapId,
      gateName: decision.leftAreaGate ?? null, exitedAt: decision.leftAreaAt!,
      publishedAt: live.publishedAt ?? "", decisionId: null };
  }
  const exit = status?.exit;
  if (!presence || !exit || exit.mapId !== presence.raw.mapId) return;
  // A newer live inside decision supersedes a history response that is still in flight.
  if (live && Date.parse(live.publishedAt ?? "") >= Date.parse(exit.publishedAt)
    && !live.regionInference?.outsideArea) return;
  return exit;
}

export function lastObservedLocationLabel(presence: TagPresenceState, status?: AreaExitReadStatus, includeExit = true): string {
  const location = presence.lastObservedLocation;
  const floor = location.mapName ?? location.floorLabel ?? location.mapId ?? "Kat belirlenemedi";
  const exit = includeExit ? visibleAreaExit(presence, status) : undefined;
  if (exit) {
    return areaExitLabel(exit.areaName || floor, exit.gateName, exit.exitedAt);
  }
  return `${floor} · ${location.regionName ?? "Oda belirlenemedi"}`;
}

export function lastDataAgeLabel(presence: TagPresenceState, now: number): string {
  return `${formatLocationDuration(presence.lastRawReceivedAt, now)} önce`;
}

export function hiddenOnMapLabel(reason: string | undefined): string {
  return reason === "no-data" ? "Veri gelmiyor · haritada gizli"
    : reason === "no-regions" ? "Gösterim için bölge tanımlayın" : "Alan dışında · haritada gizli";
}
