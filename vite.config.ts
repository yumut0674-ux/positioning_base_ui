import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";
import { localRegionsConfig } from "./build/local-regions-config-plugin";
import { localRegionPositionOutput } from "./build/local-region-position-output-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ mode }) => {
  const applicationEnv = loadEnv(mode, process.cwd(), "");
  for (const name of ["RAW_POSITION_PORT", "REGION_POSITION_PORT", "REGION_BROADCAST_INTERVAL_MS", "REGION_POSITION_ALLOWED_ORIGIN"] as const) {
    const value = applicationEnv[name];
    if (process.env[name] === undefined && value !== undefined && value !== "") {
      process.env[name] = value;
    }
  }
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

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
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
