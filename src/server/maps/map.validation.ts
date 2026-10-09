import { z } from "zod";

const identifierSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
export const mapIdSchema = identifierSchema;

export const mapStatusSchema = z.enum(["active", "preview", "planned", "disabled"]);

export const mapCatalogEntrySchema = z.object({
  id: identifierSchema,
  buildingId: identifierSchema,
  buildingName: z.string().trim().min(1).max(160),
  floorId: identifierSchema,
  floorLevel: z.number().int().min(-20).max(300),
  floorLabel: z.string().trim().min(1).max(80),
  unitId: identifierSchema,
  unitName: z.string().trim().min(1).max(120),
  displayName: z.string().trim().min(1).max(200),
  status: mapStatusSchema,
  liveTrackingEnabled: z.boolean(),
  trackingZoneIds: z.array(z.string().trim().min(1).max(100).regex(/^[\p{L}\p{N}][\p{L}\p{M}\p{N}._:-]*$/u)).max(100).default([]),
  sortOrder: z.number().int().min(0).max(1_000_000),
  configPath: z.string().regex(/^[a-z0-9-]+\/map\.json$/).nullable(),
  regionsConfigPath: z.string().regex(/^[a-z0-9-]+\/regions\.json$/).nullable().default(null),
}).strict();

export const mapCatalogSchema = z.object({
  version: z.number().int().positive(),
  defaultMapId: identifierSchema,
  liveTrackingMapId: identifierSchema,
  maps: z.array(mapCatalogEntrySchema).min(1),
}).strict().superRefine((catalog, context) => {
  const ids = new Set<string>();
  for (const entry of catalog.maps) {
    if (ids.has(entry.id)) context.addIssue({ code: "custom", message: `Tekrarlanan harita kimliği: ${entry.id}`, path: ["maps"] });
    ids.add(entry.id);
    if (entry.liveTrackingEnabled && (!entry.configPath || !["active", "preview"].includes(entry.status))) context.addIssue({ code: "custom", message: "Canlı takip haritası aktif/seçilebilir ve yapılandırılmış olmalıdır", path: ["maps"] });
    if (!entry.liveTrackingEnabled && entry.trackingZoneIds.length) context.addIssue({ code: "custom", message: "trackingZoneIds yalnızca canlı takip etkin haritalarda kullanılabilir", path: ["maps"] });
    if (entry.regionsConfigPath && entry.regionsConfigPath !== `${entry.id}/regions.json`) context.addIssue({ code: "custom", message: "regionsConfigPath map kimliğiyle aynı güvenli dizini kullanmalıdır", path: ["maps"] });
  }
  const defaultEntry = catalog.maps.find((entry) => entry.id === catalog.defaultMapId);
  if (!defaultEntry) context.addIssue({ code: "custom", message: "defaultMapId katalogda bulunamadı", path: ["defaultMapId"] });
  else if (!defaultEntry.configPath || !["active", "preview"].includes(defaultEntry.status)) {
    context.addIssue({ code: "custom", message: "Varsayılan harita kullanılabilir bir config içermelidir", path: ["defaultMapId"] });
  }
  if (catalog.liveTrackingMapId && !catalog.maps.some((entry) => entry.id === catalog.liveTrackingMapId && entry.liveTrackingEnabled)) context.addIssue({ code: "custom", message: "liveTrackingMapId etkin bir canlı haritayı göstermelidir", path: ["liveTrackingMapId"] });
  const zones = new Map<string, string>();
  for (const entry of catalog.maps) for (const zone of entry.trackingZoneIds) {
    const key = zone.toLocaleLowerCase("en-US");
    const owner = zones.get(key);
    if (owner && owner !== entry.id) context.addIssue({ code: "custom", message: `Tracking zone birden fazla haritaya bağlı: ${zone}`, path: ["maps"] });
    zones.set(key, entry.id);
  }
});

export const mapDetailsSchema = z.object({
  id: identifierSchema,
  image: z.object({
    url: z.string().regex(/^\/maps\/[a-z0-9-]+\/[a-z0-9._-]+$/),
    width: z.number().int().positive().max(20_000),
    height: z.number().int().positive().max(20_000),
  }).strict(),
  world: z.object({
    widthMeters: z.number().positive().finite(),
    heightMeters: z.number().positive().finite(),
  }).strict(),
  calibration: z.object({
    worldOrigin: pointSchema,
    canvasOrigin: pointSchema,
    pixelsPerMeter: z.number().positive().finite(),
    invertYAxis: z.boolean(),
    rotationDegrees: z.number().finite().min(-360).max(360),
  }).strict(),
  updatedAt: z.string().datetime({ offset: true }),
  status: mapStatusSchema,
  liveTrackingEnabled: z.boolean(),
}).strict();

export type ValidatedMapCatalog = z.infer<typeof mapCatalogSchema>;
export type ValidatedMapDetails = z.infer<typeof mapDetailsSchema>;
