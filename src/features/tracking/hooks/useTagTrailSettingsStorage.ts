import { useEffect, useRef } from "react";
import { useIpsStore } from "@/src/app/store/useIpsStore";
import { persistTagTrailSettings, readTagTrailSettings } from "../services/tagTrailSettings";

export function useTagTrailSettingsStorage(): void {
  const settings = useIpsStore((state) => state.tagTrailSettings);
  const hydrate = useIpsStore((state) => state.hydrateTagTrailSettings);
  const hydratedRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      hydrate(readTagTrailSettings(window.localStorage));
      hydratedRef.current = true;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hydrate]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    persistTagTrailSettings(window.localStorage, settings);
  }, [settings]);
}
