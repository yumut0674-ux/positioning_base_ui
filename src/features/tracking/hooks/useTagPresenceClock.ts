import { useEffect, useState } from "react";
import { useIpsStore } from "@/src/app/store/useIpsStore";

export function useTagPresenceClock(): number {
  const offset = useIpsStore(state => state.presenceClockOffset);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return now + offset;
}
