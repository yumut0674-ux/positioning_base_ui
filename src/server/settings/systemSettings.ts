import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SYSTEM_SETTINGS, systemSettingsSchema, type SystemSettings } from "../../features/settings/types/settings.types";

export class SystemSettingsStorageError extends Error {}

export class FileSystemSettings {
  private pending: Promise<unknown> = Promise.resolve();
  private cached?: { value: SystemSettings; at: number };
  private revision = 0;

  public constructor(private readonly filePath = path.join(process.cwd(), "config", "system-settings.json"), private readonly now = Date.now) {}

  public async read(fresh = false): Promise<SystemSettings> {
    if (!fresh && this.cached && this.now() - this.cached.at < 1_000) return this.cached.value;
    const revision = this.revision;
    let value: SystemSettings;
    try { value = systemSettingsSchema.parse(JSON.parse(await readFile(this.filePath, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new SystemSettingsStorageError("Sistem ayarları okunamadı. Kayıtlı ayar dosyasını kontrol edin.");
      value = structuredClone(DEFAULT_SYSTEM_SETTINGS);
    }
    if (revision !== this.revision) return this.read();
    this.cached = { value, at: this.now() };
    return value;
  }

  public async save(input: unknown): Promise<SystemSettings> {
    const value = systemSettingsSchema.parse(input);
    const operation = this.pending.catch(() => undefined).then(async () => {
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
        await rename(temporary, this.filePath);
      } catch {
        throw new SystemSettingsStorageError("Sistem ayarları kaydedilemedi. Lütfen yeniden deneyin.");
      } finally { await rm(temporary, { force: true }).catch(() => undefined); }
      this.revision++;
      this.cached = { value, at: this.now() };
      return value;
    });
    this.pending = operation;
    return operation;
  }
}

type SettingsHost = NodeJS.Process & { __uwbSystemSettings?: FileSystemSettings };
const settingsHost = process as SettingsHost;
// Hot reload must not retain methods that still use an older settings schema.
export const systemSettings = settingsHost.__uwbSystemSettings = settingsHost.__uwbSystemSettings instanceof FileSystemSettings
  ? settingsHost.__uwbSystemSettings
  : new FileSystemSettings();
