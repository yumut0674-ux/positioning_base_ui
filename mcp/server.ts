import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createLocationApiClientFromEnv, type LocationApiClient } from "./client/locationApiClient";
import {
  currentLocationInputSchema, locationAtTimeInputSchema, locationHistoryInputSchema, searchEntitiesInputSchema,
} from "./schemas/toolSchemas";
import { createGetCurrentLocationHandler } from "./tools/getCurrentLocation";
import { createGetLocationAtTimeHandler } from "./tools/getLocationAtTime";
import { createGetLocationHistoryHandler } from "./tools/getLocationHistory";
import { createSearchEntitiesHandler } from "./tools/searchEntities";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function createMcpServer(client: LocationApiClient = createLocationApiClientFromEnv()): McpServer {
  const server = new McpServer(
    { name: "uwb-location-readonly", version: "1.0.0" },
    { instructions: "Bu sunucu yalnızca UWB varlık ve konum verilerini okur. Birden fazla arama sonucu varsa kullanıcıdan seçim isteyin." },
  );

  server.registerTool("search_entities", {
    title: "Varlık ara",
    description: "Ürün adı, ürün kodu veya tag koduyla varlık arar. Birden fazla sonucu otomatik seçmez.",
    inputSchema: searchEntitiesInputSchema.shape,
    annotations: READ_ONLY_ANNOTATIONS,
  }, createSearchEntitiesHandler(client));

  server.registerTool("get_current_location", {
    title: "Güncel konumu getir",
    description: "Bir varlığın aktif tag atamasına ait en yeni konumu ve güncellik durumunu getirir.",
    inputSchema: currentLocationInputSchema.shape,
    annotations: READ_ONLY_ANNOTATIONS,
  }, createGetCurrentLocationHandler(client));

  server.registerTool("get_location_at_time", {
    title: "Zamandaki konumu getir",
    description: "Bir varlığın belirtilen zamandaki geçerli tag atamasını kullanarak en yakın konumunu getirir.",
    inputSchema: locationAtTimeInputSchema.shape,
    annotations: READ_ONLY_ANNOTATIONS,
  }, createGetLocationAtTimeHandler(client));

  server.registerTool("get_location_history", {
    title: "Konum geçmişini getir",
    description: "Bir varlığın sınırlı ve gerekirse örneklenmiş rota noktalarını veya bölge zaman çizelgesini getirir.",
    inputSchema: locationHistoryInputSchema.shape,
    annotations: READ_ONLY_ANNOTATIONS,
  }, createGetLocationHistoryHandler(client));

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}

const entryPath = process.argv[1];
const isMain = entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href;

if (isMain) {
  if (process.argv.includes("--smoke")) {
    createMcpServer();
    process.stderr.write("MCP smoke test passed.\n");
  } else {
    startMcpServer().catch(() => {
      process.stderr.write("MCP server could not start.\n");
      process.exitCode = 1;
    });
  }
}
