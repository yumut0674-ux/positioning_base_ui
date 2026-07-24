import type { Plugin } from "vite";
import { request as httpRequest } from "node:http";
import { ProcessedPositionServer } from "../src/server/regionEngine/ProcessedPositionServer";
import { getRegionEngineRuntimeConfig } from "../src/server/regionEngine/runtimeConfig";

function requestEngineTick(port: number): void {
  const request = httpRequest({
    hostname: "127.0.0.1",
    port,
    path: "/api/region-engine/tick",
    method: "POST",
    agent: false,
    headers: { connection: "close" },
  });
  request.once("error", () => undefined);
  request.end();
}

/** Hosts the additional SSE port outside vinext's isolated worker in local development. */
export function localRegionPositionOutput(): Plugin {
  let output: ProcessedPositionServer | null = null;
  return {
    name: "local-region-position-output",
    apply: "serve",
    async configureServer(server) {
      const runtime = getRegionEngineRuntimeConfig();
      output = new ProcessedPositionServer(
        runtime.processedPort,
        runtime.allowedOrigin,
        false,
        () => requestEngineTick(runtime.rawPort),
        runtime.broadcastIntervalMs,
      );
      await output.start();
      server.httpServer?.once("close", () => { void output?.stop(); });
    },
  };
}
