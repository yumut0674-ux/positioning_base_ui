import { z } from "zod";
import { mapService, MapRequestError } from "@/src/server/maps/mapService";
import { mapIdSchema } from "@/src/server/maps/map.validation";
import { renderHistorySelection } from "@/src/server/location/historyMapRenderer";
import { logger } from "@/src/server/logger";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 256_000;
const inputSchema = z.object({
  mapId: mapIdSchema,
  points: z.array(z.object({ x: z.number().finite().min(-1_000_000).max(1_000_000), y: z.number().finite().min(-1_000_000).max(1_000_000) }).strict()).min(1).max(2000),
  showRoute: z.boolean(),
}).strict();

export async function POST(request: Request): Promise<Response> {
  try {
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "Seçim verisi gerekli." }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return Response.json({ error: "Seçim verisi çok büyük." }, { status: 413 }); }
      chunks.push(chunk.value);
    }
    const input = inputSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const map = await mapService.getMapDetails(input.mapId);
    const image = await renderHistorySelection(map, input.points, input.showRoute);
    return new Response(Uint8Array.from(image), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Harita seçimi geçersiz." }, { status: 400 });
    if (error instanceof MapRequestError) return Response.json({ error: error.message }, { status: error.status });
    logger.error("history.map_selection_failed", error);
    return Response.json({ error: "Seçili bölge görseli hazırlanamadı." }, { status: 503 });
  }
}
