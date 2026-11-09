import { AREA_EXIT_READ_BATCH_SIZE, type AreaExitReader } from "./areaExitReader";

export async function createAreaExitResponse(request: Request, reader: Pick<AreaExitReader, "read">): Promise<Response> {
  const tags = new URL(request.url).searchParams.getAll("tag");
  if (!tags.length || tags.length > AREA_EXIT_READ_BATCH_SIZE || tags.some(tag => !tag.trim() || tag.length > 100 || /[\x00-\x1f]/.test(tag))) {
    return Response.json({ error: "Geçersiz takip etiketi seçimi" }, { status: 400 });
  }
  try {
    return Response.json(await reader.read(tags), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Çıkış geçmişi okunamadı" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
