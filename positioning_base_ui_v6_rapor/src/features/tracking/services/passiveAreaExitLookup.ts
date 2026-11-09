import type { TagPresenceState } from "../types/tagPresence.types";
import { tagActivityPresentation } from "./tagActivityPresentation";
import { visibleAreaExit } from "./tagPresencePresentation";

export interface PassiveExitRequest { readonly tagCode: string; readonly observation: string }

const observationKey = (presence: TagPresenceState) => JSON.stringify([
  presence.raw.mapId, presence.lastRawMeasuredAt, presence.lastRawReceivedAt,
]);

/** One archive lookup per passive observation, only when the live stream has no exit to display. */
export class PassiveAreaExitLookup {
  private readonly attempted = new Map<string, string>();

  public select(states: Readonly<Record<string, TagPresenceState>>, now: number): PassiveExitRequest[] {
    for (const tag of this.attempted.keys()) if (!states[tag]) this.attempted.delete(tag);
    const requests: PassiveExitRequest[] = [];
    for (const presence of Object.values(states)) {
      const tagCode = presence.tagCode;
      if (tagActivityPresentation(undefined, presence, now).activity !== "offline"
        || presence.hasCurrentRoomAssignment || visibleAreaExit(presence, undefined)) {
        this.attempted.delete(tagCode);
        continue;
      }
      const observation = observationKey(presence);
      if (this.attempted.get(tagCode) === observation) continue;
      this.attempted.set(tagCode, observation);
      requests.push({ tagCode, observation });
    }
    return requests;
  }

  public isCurrent(presence: TagPresenceState | undefined, request: PassiveExitRequest, now: number): boolean {
    return !!presence && observationKey(presence) === request.observation
      && !presence.hasCurrentRoomAssignment
      && tagActivityPresentation(undefined, presence, now).activity === "offline" && !visibleAreaExit(presence, undefined);
  }
}
