import { createHash } from "node:crypto";
import type { TrackedTag } from "../../features/tracking/types/tracking.types";
import type { RegionsConfig } from "../../features/regions/types/region.types";
import type { SystemSettings } from "../../features/settings/types/settings.types";
import type { AreaExitNotification } from "../../features/notifications/notification.types";
import { roomDecisionLabel } from "../../features/tracking/services/roomDecisionLabel";
import { LOCATION_ZONE_FALLBACK_LABEL } from "../../features/map/services/LocationResolverService";

interface Episode {
  mapId: string; exitedAt: string; startedAt: number; reported: boolean;
  areaId?: string; areaName?: string; timeSource: AreaExitNotification["timeSource"]; sourceLabel: string;
}
interface Observation {
  mapId: string; areaId?: string; areaName?: string; episode?: Episode;
}
export interface ObserverCheckpoint {
  states: [string, Observation][];
  pending: AreaExitNotification[];
}

/** Reads the exact quick-list label/output. Never writes a position or calls an inference engine. */
export class AreaExitObserver {
  private states = new Map<string, Observation>();
  private pending = new Map<string, AreaExitNotification>();
  public revision = 0;

  public restore(checkpoint: ObserverCheckpoint): void {
    this.states = new Map(checkpoint.states);
    this.pending = new Map(checkpoint.pending.map(item => [item.id, item]));
  }
  public checkpoint(): ObserverCheckpoint { return structuredClone({ states: [...this.states], pending: [...this.pending.values()] }); }
  public pendingItems(): AreaExitNotification[] { return [...this.pending.values()]; }
  public acknowledge(ids: readonly string[]): void { for (const id of ids) this.pending.delete(id); this.revision++; }
  public remove(tagCode: string): void { if (this.states.delete(tagCode)) this.revision++; }

  public observe(tag: TrackedTag, config: RegionsConfig | undefined, enabled: boolean, now: number, hidden = false): void {
    if (!enabled || !tag.mapId || tag.timestamp <= 0 || !config || config.map.mapId !== tag.mapId) {
      this.remove(tag.id); return;
    }
    const label = roomDecisionLabel(tag, config, now);
    const engineOutside = Boolean(tag.regionInference?.enabled && tag.regionInference.outsideArea);
    const outside = engineOutside || label === LOCATION_ZONE_FALLBACK_LABEL;
    const previous = this.states.get(tag.id);
    // Old coordinates and uncertain decisions are not evidence of a new exit.
    if ((hidden && !engineOutside) || (!outside && (tag.regionInference?.state === "LOCATION_LOST" || tag.regionInference?.signalLost))) {
      // A gap is not a re-entry. Preserve a reported episode until a real inside result arrives.
      if (!previous?.episode?.reported) this.remove(tag.id);
      return;
    }
    if (!outside) {
      const room = config.regions.find(region => region.id === tag.regionInference?.regionId);
      const next: Observation = { mapId: tag.mapId, areaId: room?.id, areaName: room?.name ?? label };
      if (JSON.stringify(next) !== JSON.stringify(previous)) { this.states.set(tag.id, next); this.revision++; }
      return;
    }
    const engineAt = engineOutside ? Date.parse(tag.regionInference?.leftAreaAt ?? "") : NaN;
    const validEngineAt = Number.isFinite(engineAt) && engineAt <= now;
    const exitedAt = validEngineAt ? new Date(engineAt).toISOString() : new Date(now).toISOString();
    const old = previous?.mapId === tag.mapId ? previous : undefined;
    // Repeated outside heartbeats keep the original deadline. A newer engine exit starts a new episode.
    if (old?.episode) {
      if (!validEngineAt || old.episode.exitedAt === exitedAt) return;
      if (old.episode.timeSource === "observed_result") {
        if (!old.episode.reported) {
          old.episode.exitedAt = exitedAt;
          old.episode.startedAt = engineAt;
          old.episode.timeSource = "engine";
          old.episode.sourceLabel = label;
          this.revision++;
        }
        return;
      }
    }
    const area = engineOutside ? config.largeAreas?.[0] : undefined;
    const episode: Episode = {
      mapId: tag.mapId, exitedAt, startedAt: validEngineAt ? engineAt : now, reported: false,
      areaId: area?.id ?? old?.areaId, areaName: area?.name ?? old?.areaName,
      timeSource: validEngineAt ? "engine" : "observed_result", sourceLabel: label,
    };
    this.states.set(tag.id, { mapId: tag.mapId, areaId: old?.areaId, areaName: old?.areaName, episode });
    this.revision++;
  }

  public tick(now: number, settings: SystemSettings["notifications"], names: ReadonlyMap<string, string>): void {
    for (const [tagCode, state] of this.states) {
      const episode = state.episode;
      if (!episode || episode.reported || now - episode.startedAt < settings.exitDelayMs) continue;
      const id = `notification-${createHash("sha256").update(JSON.stringify([tagCode, episode.mapId, episode.exitedAt])).digest("hex")}`;
      this.pending.set(id, {
        id, tagCode, tagName: names.get(tagCode) || tagCode, mapId: episode.mapId,
        areaId: episode.areaId, areaName: episode.areaName, exitedAt: episode.exitedAt,
        createdAt: new Date(now).toISOString(), displayDurationMs: settings.displayDurationMs,
        exitDelayMs: settings.exitDelayMs, timeSource: episode.timeSource, sourceLabel: episode.sourceLabel,
      });
      episode.reported = true;
      this.revision++;
    }
  }
}
