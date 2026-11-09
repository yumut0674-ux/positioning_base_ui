import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import type { AreaExitNotification } from "../../src/features/notifications/notification.types";

let startedAt = 0;
export default defineConfig({
  root: path.resolve(process.cwd(), "output/notification-preview"),
  server: { host: "127.0.0.1", port: 3105, fs: { allow: [process.cwd()] } },
  plugins: [react(), { name: "notification-preview-fixture", configureServer(server) {
    server.middlewares.use("/api/notifications", (_request, response) => {
      startedAt ||= Date.now();
      const make = (id: string, name: string, duration: number): AreaExitNotification => ({
        id: `preview-${id}-${startedAt}`, tagCode: id, tagName: name, mapId: "Servis", areaName: "Servis", areaId: "ward",
        exitedAt: new Date(startedAt - 5000).toISOString(), createdAt: new Date(startedAt).toISOString(),
        displayDurationMs: duration, exitDelayMs: 5000, timeSource: "engine", sourceLabel: "Servis alanından çıktı",
      });
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ serverNow: Date.now(), warning: null,
        items: [make("TAG-001", "Pompa", 30_000), make("TAG-002", "Monitör", 120_000)]
          .filter(item => Date.parse(item.createdAt) + item.displayDurationMs > Date.now()) }));
    });
  } }],
});
