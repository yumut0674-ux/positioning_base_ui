import { mapCatalogSchema, mapDetailsSchema } from "@/src/server/maps/map.validation";
import type { MapCatalog, MapDetails } from "@/src/server/maps/map.types";

interface ErrorEnvelope {
  readonly error?: { readonly message?: string };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

export async function fetchMapCatalog(signal?: AbortSignal): Promise<MapCatalog> {
  const response = await fetch("/api/maps", { headers: { Accept: "application/json" }, cache: "no-store", signal });
  const payload = await readJson(response);
  if (!response.ok) {
    const message = (payload as ErrorEnvelope | null)?.error?.message;
    throw new Error(message || "Harita kataloğu yüklenemedi.");
  }
  const parsed = mapCatalogSchema.safeParse(payload);
  if (!parsed.success) throw new Error("Harita kataloğu geçersiz.");
  return parsed.data as MapCatalog;
}

export async function fetchMapDetails(mapId: string, signal?: AbortSignal): Promise<MapDetails> {
  const response = await fetch(`/api/maps/${encodeURIComponent(mapId)}`, { headers: { Accept: "application/json" }, cache: "no-store", signal });
  const payload = await readJson(response);
  if (!response.ok) {
    const message = (payload as ErrorEnvelope | null)?.error?.message;
    throw new Error(message || "Harita yapılandırması yüklenemedi.");
  }
  const parsed = mapDetailsSchema.safeParse(payload);
  if (!parsed.success) throw new Error("Harita yapılandırması geçersiz.");
  return parsed.data as MapDetails;
}
