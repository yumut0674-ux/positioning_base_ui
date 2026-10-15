import { ZodError } from "zod";
import { DEFAULT_SYSTEM_SETTINGS } from "../../features/settings/types/settings.types";
import { FileSystemSettings, SystemSettingsStorageError, systemSettings } from "./systemSettings";

export function createSettingsHandlers(settings: FileSystemSettings = systemSettings, changed: () => Promise<void> = async () => {}) {
  const errorResponse = (error: unknown) => Response.json({ error: error instanceof ZodError
    ? "Gizleme süresi 1 ile 86400 saniye arasında bir tam sayı olmalıdır."
    : error instanceof Error ? error.message : "Ayar isteği başarısız." }, { status: error instanceof SystemSettingsStorageError ? 503 : 400 });
  return {
    async get(): Promise<Response> {
      try { return Response.json({ settings: await settings.read(true), defaults: DEFAULT_SYSTEM_SETTINGS }, { headers: { "Cache-Control": "no-store" } }); }
      catch (error) { return errorResponse(error); }
    },
    async put(request: Request): Promise<Response> {
      try {
        const saved = await settings.save(await request.json());
        await changed();
        return Response.json({ settings: saved, defaults: DEFAULT_SYSTEM_SETTINGS }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) { return errorResponse(error); }
    },
  };
}
