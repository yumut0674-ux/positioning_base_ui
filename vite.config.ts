import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import { localRegionsConfig } from "./build/local-regions-config-plugin";
import { localRegionPositionOutput } from "./build/local-region-position-output-plugin";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(({ mode }) => {
  const applicationEnv = loadEnv(mode, process.cwd(), "");
  for (const name of ["RAW_POSITION_PORT", "REGION_POSITION_PORT", "REGION_BROADCAST_INTERVAL_MS", "REGION_POSITION_ALLOWED_ORIGIN"] as const) {
    const value = applicationEnv[name];
    if (process.env[name] === undefined && value !== undefined && value !== "") {
      process.env[name] = value;
    }
  }

  return {
    define: {
      __RAW_POSITION_PORT__: JSON.stringify(process.env.RAW_POSITION_PORT ?? ""),
      __REGION_POSITION_PORT__: JSON.stringify(process.env.REGION_POSITION_PORT ?? ""),
      __REGION_BROADCAST_INTERVAL_MS__: JSON.stringify(process.env.REGION_BROADCAST_INTERVAL_MS ?? ""),
      __REGION_POSITION_ALLOWED_ORIGIN__: JSON.stringify(process.env.REGION_POSITION_ALLOWED_ORIGIN ?? ""),
    },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      localRegionPositionOutput(),
      localRegionsConfig(),
      vinext(),
    ],
  };
});
