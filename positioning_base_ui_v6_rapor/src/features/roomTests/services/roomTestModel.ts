import { z } from "zod";
import type { MapCatalogEntry } from "@/src/server/maps/map.types";
import type { RegionsConfig } from "@/src/features/regions/types/region.types";

const text = z.string().trim().min(1).max(150);
const time = z.string().datetime();
export const areaSchema = z.object({
  id: text, name: text, type: z.enum(["room", "corridor", "entrance", "exit"]), connectsTo: text.optional(),
});
export const planSchema = z.object({
  source: z.enum(["system", "custom"]), building: text,
  floors: z.array(z.object({ id: text, mapId: text, name: text, areas: z.array(areaSchema).max(1000), config: z.unknown().optional() })).min(1).max(100),
}).superRefine((plan, context) => {
  const maps = new Set<string>();
  for (const floor of plan.floors) {
    if (maps.has(floor.mapId)) context.addIssue({ code: "custom", message: "Kat/harita kimlikleri benzersiz olmalı." });
    maps.add(floor.mapId);
    const ids = new Set(floor.areas.map(area => area.id));
    if (ids.size !== floor.areas.length) context.addIssue({ code: "custom", message: `${floor.name}: alan kimlikleri benzersiz olmalı.` });
    for (const area of floor.areas) if (area.connectsTo && (area.connectsTo === area.id || !ids.has(area.connectsTo))) {
      context.addIssue({ code: "custom", message: `${area.name}: bağlantı aynı kattaki başka bir alana ait olmalı.` });
    }
  }
});
export type TestPlan = z.infer<typeof planSchema>;
export type TestArea = z.infer<typeof areaSchema>;
const locationSchema = z.object({ mapId: text, areaId: text });
export const seedSchema = z.object({
  id: z.string().regex(/^test-[a-zA-Z0-9-]{1,80}$/), name: text,
  tagCodes: z.array(text).max(30), tagVerified: z.boolean(), plan: planSchema,
  mode: z.enum(["floor", "route"]), route: z.array(locationSchema).max(200), createdAt: time,
  clockSample: z.object({ measuredAt: time, offsetMs: z.number().finite(), uncertaintyMs: z.number().finite().nonnegative() }).optional(),
}).superRefine((seed, context) => {
  if (!seed.plan.floors.some(floor => floor.areas.length)) context.addIssue({ code: "custom", message: "Plana en az bir alan ekleyin." });
  if (seed.tagVerified && !seed.tagCodes.length) context.addIssue({ code: "custom", message: "Doğrulama için tag kodu gerekli." });
  if (seed.mode === "route" && !seed.route.length) context.addIssue({ code: "custom", message: "Sıralı rota için en az bir adım ekleyin." });
  for (const step of seed.route) if (!seed.plan.floors.find(floor => floor.mapId === step.mapId)?.areas.some(area => area.id === step.areaId)) {
    context.addIssue({ code: "custom", message: "Rota adımı planda bulunamadı." });
  }
});
export type SessionSeed = z.infer<typeof seedSchema>;
export const actionSchema = z.object({
  id: z.string().uuid(), at: time,
  type: z.enum(["start", "select", "leave", "pause", "resume", "complete", "undo", "tags", "recover"]),
  location: locationSchema.optional(), targetId: z.string().uuid().optional(), routeStep: z.number().int().min(0).optional(),
  tagCodes: z.array(text).max(30).optional(), tagVerified: z.boolean().optional(), reason: text.optional(),
});
export type TestAction = z.infer<typeof actionSchema>;
export interface TestEvent extends TestAction { receivedAt: string | null; sequence: number }
export type TestStatus = "draft" | "running" | "paused" | "completed";
export interface TestSession extends SessionSeed {
  schemaVersion: "3.0"; timezone: "Europe/Istanbul"; configHash: string;
  version: number; revision: number; revisionReason: string; events: TestEvent[];
}
export interface TestVisit {
  id: string; mapId: string; floorId: string; floorName: string; areaId: string; areaName: string;
  areaType: TestArea["type"]; enteredAt: string; exitedAt: string | null; durationSeconds: number | null;
}
export interface RecordingSegment { from: string; to: string | null }
export class TestError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export function effectiveEvents(session: TestSession): TestEvent[] {
  const undone = new Set(session.events.filter(event => event.type === "undo").map(event => event.targetId));
  return session.events.filter(event => event.type !== "undo" && !undone.has(event.id));
}

export function projectSession(session: TestSession) {
  let status: TestStatus = "draft", startedAt: string | null = null, endedAt: string | null = null;
  let tagCodes = session.tagCodes, tagVerified = session.tagVerified, routeProgress = 0;
  const visits: TestVisit[] = [], segments: RecordingSegment[] = [];
  const closeVisit = (at: string) => {
    const active = visits.at(-1);
    if (active && active.exitedAt === null) {
      active.exitedAt = at;
      active.durationSeconds = (Date.parse(at) - Date.parse(active.enteredAt)) / 1000;
    }
  };
  for (const event of effectiveEvents(session)) {
    if (event.type === "start" || event.type === "resume") {
      status = "running"; startedAt ??= event.at; segments.push({ from: event.at, to: null });
    } else if (event.type === "select") {
      closeVisit(event.at);
      const floor = session.plan.floors.find(floor => floor.mapId === event.location?.mapId)!;
      const area = floor.areas.find(area => area.id === event.location?.areaId)!;
      visits.push({ id: event.id, mapId: floor.mapId, floorId: floor.id, floorName: floor.name, areaId: area.id, areaName: area.name,
        areaType: area.type, enteredAt: event.at, exitedAt: null, durationSeconds: null });
      if (event.routeStep !== undefined) routeProgress = event.routeStep + 1;
    } else if (event.type === "leave") closeVisit(event.at);
    else if (["pause", "recover", "complete"].includes(event.type)) {
      closeVisit(event.at);
      if (segments.at(-1)?.to === null) segments.at(-1)!.to = event.at;
      status = event.type === "complete" ? "completed" : "paused";
      if (status === "completed") endedAt = event.at;
    } else if (event.type === "tags") {
      tagCodes = event.tagCodes!; tagVerified = event.tagVerified!;
    }
  }
  const active = visits.find(visit => visit.exitedAt === null) ?? null;
  const undoTarget = effectiveEvents(session).at(-1);
  return { status, startedAt, endedAt, tagCodes, tagVerified, visits, active, segments, routeProgress,
    undoTarget: status === "running" && undoTarget && ["select", "leave"].includes(undoTarget.type) ? undoTarget.id : null };
}

export function createSession(seed: SessionSeed, configHash = ""): TestSession {
  const parsed = seedSchema.parse(seed);
  return { ...parsed, tagCodes: [...new Set(parsed.tagCodes)], schemaVersion: "3.0", timezone: "Europe/Istanbul", configHash,
    version: 0, revision: 1, revisionReason: "İlk saha kaydı", events: [] };
}

/** One event represents the entire handoff; undo leaves its audit entry in place. */
export function applyAction(session: TestSession, input: TestAction, receivedAt: string | null = null): TestSession {
  const action = actionSchema.parse(input);
  const duplicate = session.events.find(event => event.id === action.id);
  if (duplicate) {
    const previous = actionSchema.parse(duplicate);
    if (JSON.stringify(previous) !== JSON.stringify(action)) throw new TestError("Aynı işlem kimliği farklı içerikle kullanılamaz.", 409);
    return session;
  }
  if (session.events.length >= 20000) throw new TestError("Oturum olay sınırına ulaştı. Yeni bir test oluşturun.");
  const lastAt = session.events.at(-1)?.at ?? session.createdAt;
  if (Date.parse(action.at) < Date.parse(lastAt)) throw new TestError("Cihaz saati geriye gitti. Son işlemden önce kayıt yapılamaz.");
  const state = projectSession(session);
  const requireStatus = (...statuses: TestStatus[]) => { if (!statuses.includes(state.status)) throw new TestError("Bu işlem mevcut kayıt durumunda kullanılamaz.", 409); };
  if (action.type === "start") requireStatus("draft");
  if (action.type === "resume") requireStatus("paused");
  if (["select", "leave", "pause", "recover", "undo"].includes(action.type)) requireStatus("running");
  if (action.type === "complete") requireStatus("running", "paused");
  if (action.type === "select") {
    const floor = session.plan.floors.find(floor => floor.mapId === action.location?.mapId);
    if (!floor?.areas.some(area => area.id === action.location?.areaId)) throw new TestError("Alan bu oturumun planında bulunamadı.");
    if (state.active && state.active.mapId === action.location?.mapId && state.active.areaId === action.location?.areaId) throw new TestError("Bu alan zaten aktif.");
    if (action.routeStep !== undefined) {
      const step = session.route[state.routeProgress];
      if (session.mode !== "route" || action.routeStep !== state.routeProgress || step?.mapId !== action.location?.mapId || step?.areaId !== action.location?.areaId) throw new TestError("Sıralı rota adımı geçersiz.");
    }
  }
  if (action.type === "leave" && !state.active) throw new TestError("Çıkış yapılacak aktif alan yok.");
  if (action.type === "undo" && (!state.undoTarget || action.targetId !== state.undoTarget)) throw new TestError("Yalnızca son alan değişikliği geri alınabilir.");
  if (action.type === "tags") {
    requireStatus("draft", "paused", "completed");
    if (!action.tagCodes || action.tagVerified === undefined || !action.reason) throw new TestError("Tag düzeltmesi için kimlik, doğrulama ve açıklama gerekli.");
    if (action.tagVerified && !action.tagCodes.length) throw new TestError("Doğrulama için tag kodu gerekli.");
  }
  const corrected = action.type === "undo" || action.type === "tags";
  return { ...session, version: session.version + 1, revision: session.revision + (corrected ? 1 : 0),
    revisionReason: corrected ? action.reason ?? "Son geçiş geri alındı" : session.revisionReason,
    events: [...session.events, { ...action, receivedAt, sequence: session.version + 1 }] };
}

export function recordedMs(session: TestSession, now: number): number {
  return projectSession(session).segments.reduce((total, segment) => total + Math.max(0, (segment.to ? Date.parse(segment.to) : now) - Date.parse(segment.from)), 0);
}

export function systemPlan(entries: { entry: MapCatalogEntry; config: RegionsConfig }[]): TestPlan {
  const buildings = new Set(entries.map(({ entry }) => entry.buildingName));
  const kind = (region: RegionsConfig["regions"][number]) => region.kind ?? (/^corridor(?:-|$)/i.test(region.id) || /^koridor$/i.test(region.name) ? "corridor" : "room");
  return planSchema.parse({ source: "system", building: buildings.size === 1 ? entries[0].entry.buildingName : "Sistem haritaları", floors: entries.map(({ entry, config }) => ({
    id: entry.floorId, mapId: entry.id, name: `${entry.buildingName} · ${entry.floorLabel} · ${entry.unitName}`, config,
    areas: config.regions.map(region => {
      const connections = [...new Set(region.entrances.map(entrance => entrance.connectsTo).filter(Boolean))];
      const corridor = connections.length === 1 && config.regions.find(candidate => candidate.id === connections[0] && kind(candidate) === "corridor");
      return { id: region.id, name: region.name, type: kind(region), ...(corridor ? { connectsTo: corridor.id } : {}) };
    }),
  })) });
}

export function importPlan(value: unknown): TestPlan {
  if (typeof value !== "object" || !value) throw new TestError("Plan JSON'u geçersiz.");
  const legacy = value as { building?: unknown; floors?: { id: string; name: string; areas: { connects_to?: string }[] }[] };
  const plan = planSchema.parse({ source: "custom", building: legacy.building, floors: legacy.floors?.map(floor => ({
    ...floor, mapId: `custom-${floor.id}`, config: undefined,
    areas: floor.areas?.map(area => ({ ...area, connectsTo: area.connects_to ?? (area as { connectsTo?: string }).connectsTo })),
  })) });
  return plan;
}

export type ExportFormat = "tagged" | "array" | "full" | "benchmark";
export function exportSession(session: TestSession, format: ExportFormat, allAreas = false) {
  const state = projectSession(session);
  const records = state.visits.filter(visit => allAreas || visit.areaType === "room").map(visit => ({
    room: visit.areaId, entered_at: visit.enteredAt, exited_at: visit.exitedAt, duration_seconds: visit.durationSeconds,
  }));
  if (format === "array") return records;
  if (format === "full") return { ...session, ...state, undoTarget: undefined, recordedDurationSeconds: recordedMs(session, Date.now()) / 1000 };
  if (format === "tagged") return { test_id: session.id, test_name: session.name, tag_id: state.tagCodes[0] ?? null,
    tag_codes: state.tagCodes, timezone: session.timezone, started_at: state.startedAt, ended_at: state.endedAt, rooms: records };
  if (session.plan.source !== "system") throw new TestError("Benchmark için sistem haritası ve oda kimlikleri gerekli.");
  if (state.status !== "completed") throw new TestError("Benchmark çıktısı için önce testi bitirin.");
  // Only contiguous observed room/corridor intervals are scored. Unknown gaps and pauses are excluded.
  const parts: { mapId: string; visits: TestVisit[] }[] = [];
  for (const visit of state.visits) {
    if (!visit.exitedAt || !["room", "corridor"].includes(visit.areaType) || visit.exitedAt === visit.enteredAt) continue;
    const previous = parts.at(-1);
    const boundary = effectiveEvents(session).some(event => ["pause", "recover", "resume", "leave"].includes(event.type)
      && event.at >= (previous?.visits.at(-1)?.enteredAt ?? visit.enteredAt) && event.at <= visit.enteredAt);
    if (!previous || previous.mapId !== visit.mapId || previous.visits.at(-1)?.exitedAt !== visit.enteredAt || boundary) parts.push({ mapId: visit.mapId, visits: [visit] });
    else previous.visits.push(visit);
  }
  const scored = parts.filter(part => part.visits.some(visit => visit.areaType === "room"));
  if (!scored.length) throw new TestError("Dışa aktarılacak tamamlanmış oda ziyareti yok.");
  return { schemaVersion: "1.0", note: "Her parça kendi haritasıyla ayrı değerlendirilmelidir. Duraklatma ve bilinmeyen aralıklar çıkarıldı.",
    parts: scored.map((part, index) => ({ mapId: part.mapId, configHash: session.configHash,
      truth: { testId: `${session.id}-part-${index + 1}`, timezone: session.timezone, revision: session.revision, revisionReason: session.revisionReason,
        test: { from: part.visits[0].enteredAt, to: part.visits.at(-1)!.exitedAt! },
        visits: part.visits.filter(visit => visit.areaType === "room").map(visit => ({ roomId: visit.areaId, from: visit.enteredAt, to: visit.exitedAt! })),
        groups: state.tagVerified && state.tagCodes.length ? [{ id: "rota-1", tagCodes: state.tagCodes }] : [],
      }, config: session.plan.floors.find(floor => floor.mapId === part.mapId)?.config,
    })) };
}
