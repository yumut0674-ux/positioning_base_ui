import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AreaExitObserver, type ObserverCheckpoint } from "./AreaExitObserver";
import { notifications } from "./notificationRepository";
import { systemSettings } from "../settings/systemSettings";
import { tagPresenceRuntime } from "../tracking/tagPresenceRuntime";
import { mapRepository } from "../maps/mapRepository";
import { regionsConfigPathForMap } from "../regionEngine/configLoader";
import type { RegionsConfig } from "../../features/regions/types/region.types";
import type { TagPresenceState, TagPresenceUpdate } from "../../features/tracking/types/tagPresence.types";
import { buildTagQuickList } from "../../features/tracking/services/tagQuickList";
import type { TrackedTag } from "../../features/tracking/types/tracking.types";
import { DEFAULT_SYSTEM_SETTINGS } from "../../features/settings/types/settings.types";
import { logger } from "../logger";
import type { AreaExitNotification } from "../../features/notifications/notification.types";

/** Atomic checkpoint includes the outbox AND episode latch, so retries/restarts cannot duplicate an alarm. */
export class NotificationCheckpointFile {
  public constructor(private readonly file = path.join(process.cwd(), ".data", "area-exit-notifications.json")) {}
  public async read(): Promise<ObserverCheckpoint | undefined> {
    try { return JSON.parse(await readFile(this.file, "utf8")) as ObserverCheckpoint; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  }
  public async save(value: ObserverCheckpoint): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(value), "utf8");
      await rename(temp, this.file);
    } finally { await rm(temp, { force: true }).catch(() => undefined); }
  }
}

export class NotificationRuntime {
  public readonly observer = new AreaExitObserver();
  private settings = DEFAULT_SYSTEM_SETTINGS;
  private definitions = new Map<string, { name: string; enabled: boolean }>();
  private configs = new Map<string, RegionsConfig>();
  private starting?: Promise<void>;
  private refreshing = false;
  private flushing = false;
  private revision = -1;
  private durablePending: AreaExitNotification[] = [];
  private warning: string | null = null;
  private nextFlushAt = 0;
  private refreshWarning: string | null = null;
  private ready = false;
  private queued: TagPresenceUpdate[] = [];
  private observedRevisions = new Map<string, number>();

  public constructor(private readonly repository = notifications, private readonly file = new NotificationCheckpointFile()) {}
  public async start(): Promise<void> {
    this.starting ??= this.initialize().catch(error => { this.starting = undefined; throw error; });
    await this.starting;
  }
  private async initialize(): Promise<void> {
    const checkpoint = await this.file.read();
    if (checkpoint) { this.observer.restore(checkpoint); this.durablePending = checkpoint.pending; }
    // No synchronous disk/DB work is performed in the tracking listener.
    tagPresenceRuntime.service.subscribe(event => { this.queued.push(event); });
    void this.refresh();
    const timer = setInterval(() => {
      try {
        const now = Date.now();
        // Drain in order so a fast return between timer ticks still cancels the pending exit.
        for (const { state, serverNow } of this.queued.splice(0)) this.observe(state, serverNow);
        for (const state of tagPresenceRuntime.snapshot().states) this.observe(state, now);
        if (this.ready) this.observer.tick(now, this.settings.notifications, new Map([...this.definitions].map(([id, value]) => [id, value.name])));
        void this.flush();
      } catch (error) { logger.error("notifications.tick_failed", error); }
    }, 250);
    timer.unref?.();
    const refreshTimer = setInterval(() => void this.refresh(), 2_000);
    refreshTimer.unref?.();
  }
  private observe(state: TagPresenceState, now: number): void {
    if (!this.ready || (this.observedRevisions.get(state.tagCode) ?? -1) >= state.revision) return;
    this.observedRevisions.set(state.tagCode, state.revision);
    const definition = this.definitions.get(state.tagCode);
    const asTag = (point: TagPresenceState["raw"]): TrackedTag => ({ ...point, name: definition?.name ?? state.tagCode, color: "", status: "active" });
    const raw = asTag(state.raw);
    // Same merge helper as HIZLI GEÇİŞ, including held room decisions and current raw observations.
    const [tag] = buildTagQuickList({}, state.processed ? { [state.tagCode]: asTag(state.processed) } : {}, { [state.tagCode]: raw });
    this.observer.observe(tag, this.configs.get(tag.mapId ?? ""), definition?.enabled ?? false, now, state.hiddenForNoData);
  }
  private async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      this.settings = await systemSettings.read();
      const catalog = await mapRepository.readCatalog();
      const entries = await Promise.all(catalog.maps.filter(map => map.regionsConfigPath).map(async map => {
        try {
          const config = JSON.parse(await readFile(regionsConfigPathForMap(map.id), "utf8")) as RegionsConfig;
          return config.map.mapId === map.id && Array.isArray(config.regions) ? [map.id, config] as const : null;
        } catch { return null; }
      }));
      this.configs = new Map(entries.filter((item): item is readonly [string, RegionsConfig] => item !== null));
      const rows = await this.repository.definitions();
      const definitions = new Map(rows.map(row => [row.tag_code!, { name: row.name ?? row.tag_code!, enabled: row.enabled !== "false" && row.enabled !== "f" }]));
      for (const [id] of this.observer.checkpoint().states) if (!definitions.get(id)?.enabled) this.observer.remove(id);
      this.definitions = definitions;
      this.observedRevisions.clear();
      this.ready = true;
      this.refreshWarning = null;
    } catch (error) {
      if (!this.refreshWarning) logger.error("notifications.refresh_failed", error);
      this.refreshWarning = "Bildirim ayarları veya tag tercihleri yenilenemiyor; son okunan değerler kullanılıyor.";
    }
    finally { this.refreshing = false; }
  }
  public async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      if (this.observer.revision !== this.revision) {
        const revision = this.observer.revision;
        const checkpoint = this.observer.checkpoint();
        await this.file.save(checkpoint);
        this.revision = revision;
        this.durablePending = checkpoint.pending;
      }
      if (this.durablePending.length && Date.now() < this.nextFlushAt) return;
      if (this.durablePending.length) {
        const batch = this.durablePending.slice(0, 500);
        await this.repository.save(batch);
        this.observer.acknowledge(batch.map(item => item.id));
        this.durablePending = this.durablePending.filter(item => !batch.some(saved => saved.id === item.id));
      }
      this.warning = null;
      this.nextFlushAt = 0;
    } catch (error) {
      if (!this.warning) logger.error("notifications.persistence_failed", error);
      this.warning = "Bildirim kaydı bekliyor; depolama bağlantısı yeniden deneniyor.";
      this.nextFlushAt = Date.now() + 5_000;
    } finally { this.flushing = false; }
  }
  public pending(): readonly AreaExitNotification[] { return this.durablePending; }
  public status(): string | null { return this.warning ?? this.refreshWarning; }
}

type Host = NodeJS.Process & { __areaExitNotifications?: NotificationRuntime };
const host = process as Host;
export const notificationRuntime = host.__areaExitNotifications ??= new NotificationRuntime();
