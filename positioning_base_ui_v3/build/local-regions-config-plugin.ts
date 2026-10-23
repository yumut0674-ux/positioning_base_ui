import { readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import type { RegionsConfig } from "../src/features/regions/types/region.types";
import { compileRegionsConfig } from "../src/server/regionEngine/configLoader";

const MAX_CONFIG_BYTES = 2 * 1024 * 1024;

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_CONFIG_BYTES) throw new Error("Config dosyası 2 MB sınırını aşıyor");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function localRegionsConfig(): Plugin {
  const configPath = path.resolve(process.cwd(), "config", "regions.json");

  return {
    name: "local-regions-config",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (pathname !== "/api/regions") {
          next();
          return;
        }

        try {
          const saved = JSON.parse(await readFile(configPath, "utf8")) as { map?: unknown; regions?: unknown };
          if (request.method === "GET") {
            sendJson(response, 200, { config: saved });
            return;
          }
          if (request.method === "PUT") {
            const incoming = await readJsonBody(request) as { regions?: unknown };
            if (!Array.isArray(incoming.regions)) {
              sendJson(response, 400, { error: "regions alanı bir liste olmalıdır" });
              return;
            }
            const config = { ...incoming, map: saved.map, regions: incoming.regions };
            compileRegionsConfig(config as RegionsConfig);
            await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
            sendJson(response, 200, { config });
            return;
          }
          response.setHeader("allow", "GET, PUT");
          sendJson(response, 405, { error: "Desteklenmeyen istek yöntemi" });
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : "Config kaydı başarısız" });
        }
      });
    },
  };
}
