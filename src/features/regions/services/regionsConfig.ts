import type { RegionsConfig } from "../types/region.types";

export const REGIONS_CONFIG_UPDATED_EVENT = "regions-config-updated";

/** Broadcasts a saved regions configuration to the live workspace. */
export function notifyRegionsConfigUpdated(config: RegionsConfig): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<RegionsConfig>(REGIONS_CONFIG_UPDATED_EVENT, { detail: config }));
}
